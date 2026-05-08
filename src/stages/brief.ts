import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { ClientProfile, Job } from '../schemas/index.js';
import { LLMClient } from '../clients/llm-client.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Directory holding the markdown brief templates and `_coda.md` (ANCHOR §4). */
const TEMPLATES_DIR = resolve(HERE, '../prompt-templates');

/** Default output token cap matching `.env.example` (`MAX_LLM_OUTPUT_TOKENS`). */
const DEFAULT_MAX_OUTPUT_TOKENS = 8_000;

/** Arguments to `runBriefStage`. */
export interface RunBriefStageArgs {
  job: Job;
  runDir: string;
  llm: LLMClient;
  clientProfile: ClientProfile;
}

/** Result of `runBriefStage`. */
export interface RunBriefStageResult {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Tiny placeholder substitution. No template engine — just `{{key}}`
 * replacement with the values supplied in `vars`. Unknown keys are left
 * untouched (ANCHOR §4.1).
 */
function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : match,
  );
}

/** Format the run date as a human-readable string for `{{date}}`. */
function humanDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Strip the YAML frontmatter from a `raw/*.md` file produced by Stage 1
 * and return `{ url, content }` where `url` is read from the
 * `source_url` field of the frontmatter.
 */
function splitRawFile(raw: string): { url: string; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { url: '', content: raw };
  let url = '';
  try {
    const fm = yaml.load(match[1]!) as { source_url?: unknown } | null;
    if (fm && typeof fm.source_url === 'string') url = fm.source_url;
  } catch {
    /* malformed frontmatter — treat the whole file as content */
  }
  return { url, content: match[2]! };
}

/**
 * Stage 2 (Brief): reads every file in `${runDir}/raw/`, concatenates them
 * with `## Source: <URL>` headers, loads the chosen template + `_coda.md`,
 * substitutes placeholders, composes the system prompt and user message
 * per ANCHOR §6.2, calls the LLM, and writes the response to
 * `${runDir}/brief.md`.
 */
export async function runBriefStage(args: RunBriefStageArgs): Promise<RunBriefStageResult> {
  const { job, runDir, llm, clientProfile } = args;

  const rawDir = join(runDir, 'raw');
  const rawFiles = (await readdir(rawDir))
    .filter((f) => f.endsWith('.md'))
    .sort();
  if (rawFiles.length === 0) {
    throw new Error(`runBriefStage: no raw markdown files found in ${rawDir}`);
  }

  const sources: { url: string; content: string }[] = [];
  for (const f of rawFiles) {
    const raw = await readFile(join(rawDir, f), 'utf8');
    sources.push(splitRawFile(raw));
  }

  const rawContent = sources
    .map(({ url, content }) => `## Source: ${url}\n\n${content.trim()}\n`)
    .join('\n');

  const templatePath = join(TEMPLATES_DIR, `${job.template}.md`);
  let templateRaw: string;
  try {
    templateRaw = await readFile(templatePath, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`runBriefStage: cannot read template ${templatePath}: ${reason}`);
  }
  const templateBody = templateRaw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  const codaPath = join(TEMPLATES_DIR, '_coda.md');
  const coda = await readFile(codaPath, 'utf8');

  const vars: Record<string, string> = {
    client_name: clientProfile.display_name,
    prompt: job.prompt,
    raw_content: rawContent,
    date: humanDate(),
  };

  const systemPrompt = `${substitute(templateBody, vars).trim()}\n\n${substitute(coda, vars).trim()}\n`;
  const userMessage = `Original request: ${job.prompt}\n\nRaw content:\n${rawContent}`;

  const maxOutputTokens = (() => {
    const fromEnv = Number.parseInt(process.env.MAX_LLM_OUTPUT_TOKENS ?? '', 10);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_OUTPUT_TOKENS;
  })();

  const out = await llm.generateBrief({
    systemPrompt,
    userMessage,
    model: job.llm_model,
    maxOutputTokens,
  });

  if (!out.text || out.text.trim().length === 0) {
    throw new Error('runBriefStage: model returned empty response — inspect raw/ and rerun (ANCHOR §6.3)');
  }

  await writeFile(join(runDir, 'brief.md'), out.text, 'utf8');

  return { inputTokens: out.inputTokens, outputTokens: out.outputTokens };
}
