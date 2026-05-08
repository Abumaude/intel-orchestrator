import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job } from '../schemas/index.js';
import { FirecrawlClient, type FirecrawlSource } from '../clients/firecrawl-client.js';

/** Arguments to `runCrawlStage`. */
export interface RunCrawlStageArgs {
  job: Job;
  runDir: string;
  firecrawl: FirecrawlClient;
}

/** Result of `runCrawlStage`. */
export interface RunCrawlStageResult {
  pageCount: number;
}

/**
 * Best-effort URL → filesystem-safe slug. Strips `www.`, replaces dots and
 * non-alphanumeric runs with single dashes, caps length so filenames remain
 * readable. Falls back to `source` for unparseable URLs.
 */
function urlToSlug(url: string, maxLen = 40): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').replace(/\./g, '-');
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    const pathSlug = path.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    const slug = (pathSlug ? `${host}-${pathSlug}` : host).toLowerCase();
    return slug.slice(0, maxLen) || 'source';
  } catch {
    return 'source';
  }
}

/** Pad a 1-indexed integer to three digits. */
function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/**
 * Stage 1 (Crawl): dispatches on `job.mode` to call Firecrawl agent or batch
 * scrape, then writes one numbered markdown file per source into
 * `${runDir}/raw/`. Each file carries the source URL in YAML frontmatter so
 * Stage 2 can reconstruct the citation header (ANCHOR §2.2, §3.1).
 */
export async function runCrawlStage(args: RunCrawlStageArgs): Promise<RunCrawlStageResult> {
  const { job, runDir, firecrawl } = args;
  const rawDir = join(runDir, 'raw');
  await mkdir(rawDir, { recursive: true });

  let sources: FirecrawlSource[];
  if (job.mode === 'agent') {
    const result = await firecrawl.runAgent(job.prompt);
    sources = result.sources;
  } else {
    if (!job.urls || job.urls.length === 0) {
      throw new Error('runCrawlStage: targeted mode requires job.urls to be a non-empty array');
    }
    sources = await firecrawl.runBatchScrape(job.urls);
  }

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]!;
    const slug = urlToSlug(src.url);
    const filename = `${pad3(i + 1)}-${slug}.md`;
    const body = [
      '---',
      `source_url: ${src.url}`,
      '---',
      '',
      src.content,
      '',
    ].join('\n');
    await writeFile(join(rawDir, filename), body, 'utf8');
  }

  return { pageCount: sources.length };
}
