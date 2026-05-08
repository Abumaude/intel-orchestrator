import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ClientProfile,
  type Job,
  type Manifest,
  type StageRecord,
  type StageStatus,
  parseManifest,
  serializeManifest,
} from './schemas/index.js';
import { FirecrawlClient } from './clients/firecrawl-client.js';
import { LLMClient } from './clients/llm-client.js';
import { ResendClient } from './clients/resend-client.js';
import { runCrawlStage } from './stages/crawl.js';
import { runBriefStage } from './stages/brief.js';
import { runRenderStage } from './stages/render.js';
import { runDeliverStage } from './stages/deliver.js';

/** Set of stage names tracked in the manifest (ANCHOR §3.4). */
type StageName = 'crawl' | 'brief' | 'render' | 'deliver';

/** Arguments and behaviour controls for `runOrchestrator`. */
export interface OrchestratorOptions {
  /** When true, skip stages whose artefact already exists (ANCHOR §2.6). */
  resume: boolean;
  /** When true, run Stage 1 only and skip stages 2–4 (Step 9 / `--dry-run`). */
  dryRun?: boolean;
  /** Human-readable brief name used in the email subject line. */
  briefName: string;
  /** Three API clients. The CLI instantiates these and hands them in. */
  clients: {
    firecrawl: FirecrawlClient;
    llm: LLMClient;
    resend: ResendClient;
  };
  /**
   * Optional cost calculator. Called once at the end of the run with the
   * accumulated counters; the returned USD value is written to
   * `manifest.costs.estimated_usd`. If omitted, costs are recorded as 0.
   */
  estimateCostUsd?: (counts: {
    firecrawlPages: number;
    llmInputTokens: number;
    llmOutputTokens: number;
    model: Job['llm_model'];
  }) => number;
  /**
   * Optional lifecycle hook. Fires after each stage finishes, regardless of
   * outcome. Used by the CLI to print live progress lines (ANCHOR §8.3).
   */
  onStageEnd?: (info: {
    stage: 'crawl' | 'brief' | 'render' | 'deliver';
    status: StageStatus;
    durationMs: number;
    record: StageRecord;
    manifest: Manifest;
    skipped: boolean;
  }) => void;
}

/**
 * Render a `Job` to the `job.md` file written before Stage 1 begins. The
 * frontmatter is the canonical record; the body is a human-readable
 * restatement of the prompt (ANCHOR §3.1 — `job.md` is never modified
 * after creation).
 */
function renderJobMarkdown(job: Job): string {
  const fm: string[] = [
    '---',
    `client_slug: ${job.client_slug}`,
    `run_slug: ${job.run_slug}`,
    `mode: ${job.mode}`,
  ];
  if (job.urls && job.urls.length > 0) {
    fm.push('urls:');
    for (const u of job.urls) fm.push(`  - ${u}`);
  }
  fm.push(`template: ${job.template}`);
  fm.push(`llm_model: ${job.llm_model}`);
  fm.push(`created_at: ${job.created_at}`);
  fm.push('---');
  fm.push('');
  fm.push(`# Job: ${job.run_slug}`);
  fm.push('');
  fm.push('## Prompt');
  fm.push('');
  fm.push(job.prompt.trim());
  fm.push('');
  return fm.join('\n');
}

/** Build a fresh manifest with every stage in `pending` and zero costs. */
function initialManifest(job: Job): Manifest {
  const blank: StageRecord = { status: 'pending' };
  return {
    job,
    stages: { crawl: blank, brief: blank, render: blank, deliver: blank },
    costs: {
      firecrawl_calls: 0,
      llm_input_tokens: 0,
      llm_output_tokens: 0,
      estimated_usd: 0,
    },
  };
}

/**
 * Atomic write of `manifest.json`: serialise via the zod-validated
 * helper, write to a sibling `.tmp` file, then `rename` over the target so
 * a crash mid-write cannot leave a corrupted manifest on disk
 * (Step 8 atomicity requirement).
 */
async function writeManifestAtomically(manifestPath: string, manifest: Manifest): Promise<void> {
  const tmp = `${manifestPath}.tmp`;
  await writeFile(tmp, serializeManifest(manifest), 'utf8');
  await rename(tmp, manifestPath);
}

/**
 * Test the resumability predicate for each stage (ANCHOR §2.6). The check
 * is purely on artefact existence, not manifest status, so a partially
 * completed run is recoverable even if the manifest was lost.
 */
async function stageAlreadyDone(stage: StageName, runDir: string, manifest: Manifest): Promise<boolean> {
  switch (stage) {
    case 'crawl': {
      const rawDir = join(runDir, 'raw');
      if (!existsSync(rawDir)) return false;
      const entries = await readdir(rawDir);
      return entries.some((e) => e.endsWith('.md'));
    }
    case 'brief':
      return existsSync(join(runDir, 'brief.md'));
    case 'render':
      return existsSync(join(runDir, 'brief.pdf'));
    case 'deliver':
      return manifest.stages.deliver.status === 'success';
  }
}

/** Stamp a stage record with status/timing/error and persist the manifest atomically. */
async function persistStage(
  manifestPath: string,
  manifest: Manifest,
  stage: StageName,
  patch: Partial<StageRecord> & { status: StageStatus },
): Promise<void> {
  manifest.stages[stage] = { ...manifest.stages[stage], ...patch };
  await writeManifestAtomically(manifestPath, manifest);
}

/**
 * Run the full four-stage pipeline for `job`. Creates the run directory,
 * writes `job.md`, initialises (or reads) the manifest, executes stages
 * gated by the resumability predicates, atomically updates the manifest
 * after each stage, and returns the final manifest.
 *
 * Throws after recording a failure in the manifest if any stage fails;
 * the manifest on disk reflects the failure point so the operator can
 * `--resume` after fixing the cause (ANCHOR §2.1, §2.6).
 */
export async function runOrchestrator(args: {
  job: Job;
  clientProfile: ClientProfile;
  options: OrchestratorOptions;
}): Promise<Manifest> {
  const { job, clientProfile, options } = args;
  const { resume, dryRun = false, briefName, clients } = options;

  const runDir = join('runs', job.client_slug, job.run_slug);
  const dirExists = existsSync(runDir);
  if (dirExists && !resume) {
    throw new Error(
      `runOrchestrator: run directory already exists at ${runDir}. Pass options.resume=true to continue, or choose a different run_slug.`,
    );
  }
  await mkdir(join(runDir, 'raw'), { recursive: true });

  const jobMdPath = join(runDir, 'job.md');
  if (!existsSync(jobMdPath)) {
    await writeFile(jobMdPath, renderJobMarkdown(job), 'utf8');
  }

  const manifestPath = join(runDir, 'manifest.json');
  let manifest: Manifest;
  if (existsSync(manifestPath)) {
    try {
      manifest = parseManifest(await readFile(manifestPath, 'utf8'));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`runOrchestrator: existing manifest at ${manifestPath} is unreadable: ${reason}`);
    }
  } else {
    manifest = initialManifest(job);
    await writeManifestAtomically(manifestPath, manifest);
  }

  const runStage = async (
    stage: StageName,
    body: () => Promise<{ artefacts: string[] }>,
  ): Promise<void> => {
    const t0 = Date.now();
    if (resume && (await stageAlreadyDone(stage, runDir, manifest))) {
      if (manifest.stages[stage].status !== 'success') {
        await persistStage(manifestPath, manifest, stage, {
          status: 'success',
          ended_at: manifest.stages[stage].ended_at ?? new Date().toISOString(),
        });
      }
      options.onStageEnd?.({
        stage,
        status: 'success',
        durationMs: Date.now() - t0,
        record: manifest.stages[stage],
        manifest,
        skipped: true,
      });
      return;
    }
    const startedAt = new Date().toISOString();
    await persistStage(manifestPath, manifest, stage, {
      status: 'running',
      started_at: startedAt,
      error: undefined,
    });
    try {
      const { artefacts } = await body();
      await persistStage(manifestPath, manifest, stage, {
        status: 'success',
        ended_at: new Date().toISOString(),
        artefacts,
      });
      options.onStageEnd?.({
        stage,
        status: 'success',
        durationMs: Date.now() - t0,
        record: manifest.stages[stage],
        manifest,
        skipped: false,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await persistStage(manifestPath, manifest, stage, {
        status: 'failed',
        ended_at: new Date().toISOString(),
        error: reason,
      });
      options.onStageEnd?.({
        stage,
        status: 'failed',
        durationMs: Date.now() - t0,
        record: manifest.stages[stage],
        manifest,
        skipped: false,
      });
      throw new Error(`runOrchestrator: stage "${stage}" failed: ${reason}`);
    }
  };

  // Stage 1: Crawl
  await runStage('crawl', async () => {
    const out = await runCrawlStage({ job, runDir, firecrawl: clients.firecrawl });
    manifest.costs.firecrawl_calls += out.pageCount;
    const rawFiles = (await readdir(join(runDir, 'raw')))
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => join('raw', f));
    return { artefacts: rawFiles };
  });

  if (dryRun) {
    return manifest;
  }

  // Stage 2: Brief
  await runStage('brief', async () => {
    const out = await runBriefStage({ job, runDir, llm: clients.llm, clientProfile });
    manifest.costs.llm_input_tokens += out.inputTokens;
    manifest.costs.llm_output_tokens += out.outputTokens;
    return { artefacts: ['brief.md'] };
  });

  // Stage 3: Render
  await runStage('render', async () => {
    await runRenderStage({ runDir, runSlug: job.run_slug });
    return { artefacts: ['brief.pdf'] };
  });

  // Stage 4: Deliver
  await runStage('deliver', async () => {
    const out = await runDeliverStage({
      runDir,
      clientProfile,
      runSlug: job.run_slug,
      briefName,
      resend: clients.resend,
    });
    manifest.stages.deliver = {
      ...manifest.stages.deliver,
      artefacts: [`message-id:${out.messageId}`],
    };
    return { artefacts: [`message-id:${out.messageId}`] };
  });

  // Final cost roll-up.
  if (options.estimateCostUsd) {
    manifest.costs.estimated_usd = options.estimateCostUsd({
      firecrawlPages: manifest.costs.firecrawl_calls,
      llmInputTokens: manifest.costs.llm_input_tokens,
      llmOutputTokens: manifest.costs.llm_output_tokens,
      model: job.llm_model,
    });
    await writeManifestAtomically(manifestPath, manifest);
  }

  return manifest;
}
