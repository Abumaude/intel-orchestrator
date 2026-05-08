import 'dotenv/config';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import yaml from 'js-yaml';
import {
  type Job,
  JobSchema,
  type LLMModel,
  type Mode,
  parseClientProfile,
  type ClientProfile,
} from './schemas/index.js';
import { FirecrawlClient } from './clients/firecrawl-client.js';
import { LLMClient } from './clients/llm-client.js';
import { ResendClient } from './clients/resend-client.js';
import { runOrchestrator } from './orchestrator.js';

/** Required environment variables (ANCHOR §9.4). */
const REQUIRED_ENV = [
  'FIRECRAWL_API_KEY',
  'ANTHROPIC_API_KEY',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
] as const;

/**
 * Operator data directories live relative to the working directory; templates
 * and pricing config ship with the install and resolve relative to this file.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENTS_DIR = resolve(process.cwd(), 'clients');
const RUNS_DIR = resolve(process.cwd(), 'runs');
const TEMPLATES_DIR = resolve(HERE, 'prompt-templates');
const PRICING_PATH = resolve(HERE, 'config/pricing.ts');

/** Format the local calendar date as `YYYY-MM-DD` for run slugs. */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Lowercase, kebab-case, alphanumeric, max 30 chars. Empty input → "run". */
function kebab(s: string, maxLen = 30): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen);
  return slug || 'run';
}

/**
 * Verify every required env var is set. On any miss, write a clear
 * multi-line error to stderr and exit 1 (ANCHOR §9.4).
 */
function ensureRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k] || !process.env[k]!.trim());
  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    for (const k of missing) console.error(`  - ${k}`);
    console.error('\nCopy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

/**
 * Read the `// Validated: YYYY-MM-DD` stamp from `src/config/pricing.ts`.
 * If the file is missing or has no stamp, returns null. Used to warn the
 * operator when pricing rates are stale (ANCHOR §5.3).
 */
function readPricingStamp(): { date: string; ageDays: number } | null {
  if (!existsSync(PRICING_PATH)) return null;
  const text = readFileSync(PRICING_PATH, 'utf8');
  const m = text.match(/Validated:\s*(\d{4}-\d{2}-\d{2})/);
  if (!m || !m[1]) return null;
  const date = m[1];
  const stamp = new Date(date + 'T00:00:00Z');
  const ageDays = Math.floor((Date.now() - stamp.getTime()) / 86_400_000);
  return { date, ageDays };
}

/** Best-effort dynamic load of the optional pricing module from Step 10. */
async function tryLoadEstimateCostUsd(): Promise<
  | ((counts: {
      firecrawlPages: number;
      llmInputTokens: number;
      llmOutputTokens: number;
      model: LLMModel;
    }) => number)
  | undefined
> {
  if (!existsSync(PRICING_PATH)) return undefined;
  try {
    // Dynamic specifier to avoid a static type-check dependency on Step 10.
    const specifier = './config/pricing.js';
    const mod = (await import(specifier)) as {
      estimateCostUsd?: (counts: {
        firecrawlPages: number;
        llmInputTokens: number;
        llmOutputTokens: number;
        model: LLMModel;
      }) => number;
    };
    return typeof mod.estimateCostUsd === 'function' ? mod.estimateCostUsd : undefined;
  } catch {
    return undefined;
  }
}

/**
 * List every client folder under `clients/` and print its slug + display
 * name. Folders whose `profile.md` cannot be parsed are flagged but do not
 * abort the listing.
 */
function cmdListClients(): void {
  if (!existsSync(CLIENTS_DIR)) {
    console.log('(no clients/ directory found)');
    return;
  }
  const entries = readdirSync(CLIENTS_DIR).filter((e) => {
    const stat = statSync(join(CLIENTS_DIR, e));
    return stat.isDirectory();
  });
  if (entries.length === 0) {
    console.log('(no clients configured)');
    return;
  }
  for (const slug of entries.sort()) {
    const profilePath = join(CLIENTS_DIR, slug, 'profile.md');
    if (!existsSync(profilePath)) {
      console.log(`${slug.padEnd(24)} (no profile.md)`);
      continue;
    }
    try {
      const profile = parseClientProfile(readFileSync(profilePath, 'utf8'));
      console.log(`${profile.client_slug.padEnd(24)} ${profile.display_name}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`${slug.padEnd(24)} (invalid profile.md: ${reason})`);
    }
  }
}

/**
 * List every brief template under `src/prompt-templates/` (excluding
 * `_coda.md`) and print its name + description from frontmatter.
 */
function cmdListTemplates(): void {
  if (!existsSync(TEMPLATES_DIR)) {
    console.log('(no src/prompt-templates/ directory found)');
    return;
  }
  const files = readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .sort();
  if (files.length === 0) {
    console.log('(no templates found)');
    return;
  }
  for (const f of files) {
    const raw = readFileSync(join(TEMPLATES_DIR, f), 'utf8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) {
      console.log(`${f.padEnd(28)} (no frontmatter)`);
      continue;
    }
    try {
      const fm = yaml.load(m[1]!) as { name?: string; description?: string };
      const name = (fm.name ?? f.replace(/\.md$/, '')).padEnd(24);
      console.log(`${name} ${fm.description ?? ''}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`${f.padEnd(28)} (invalid frontmatter: ${reason})`);
    }
  }
}

/** Stage display titles used in progress/failure output (ANCHOR §8.3). */
const STAGE_TITLES = {
  crawl: 'Crawl',
  brief: 'Brief',
  render: 'Render',
  deliver: 'Deliver',
} as const;

const STAGE_NUMBER = { crawl: 1, brief: 2, render: 3, deliver: 4 } as const;

/** Per-stage one-line guidance used in the Failure Report. */
const STAGE_FIX_HINTS: Record<keyof typeof STAGE_TITLES, string> = {
  crawl: 'check FIRECRAWL_API_KEY, page caps (MAX_FIRECRAWL_PAGES_PER_RUN), and Firecrawl status.',
  brief: 'check ANTHROPIC_API_KEY, the configured model string, and MAX_LLM_*_TOKENS caps; inspect raw/ for empty content.',
  render: 'inspect brief.md for non-empty markdown; ensure md-to-pdf can launch headless Chromium.',
  deliver: 'check RESEND_API_KEY, RESEND_FROM_EMAIL is a verified sender, and the recipient address in the client profile.',
};

/** Print the run header line per ANCHOR §8.3. */
function printRunHeader(args: {
  job: Job;
  resolutionNotes: Record<string, string>;
  resume: boolean;
  dryRun: boolean;
}): void {
  const { job, resolutionNotes, resume, dryRun } = args;
  console.log(
    `> Run: ${job.client_slug} / ${job.run_slug} — mode: ${job.mode} — template: ${job.template}`,
  );
  console.log('> Resolved arguments:');
  console.log(`    prompt:    ${JSON.stringify(job.prompt)}`);
  console.log(`    client:    ${job.client_slug}`);
  console.log(`    mode:      ${job.mode}${resolutionNotes.mode ? ` (${resolutionNotes.mode})` : ''}`);
  if (job.urls && job.urls.length > 0) console.log(`    urls:      ${job.urls.join(', ')}`);
  console.log(
    `    template:  ${job.template}${resolutionNotes.template ? ` (${resolutionNotes.template})` : ''}`,
  );
  console.log(`    model:     ${job.llm_model}${resolutionNotes.model ? ` (${resolutionNotes.model})` : ''}`);
  console.log(`    name:      ${resolutionNotes.name ?? '(derived)'}`);
  console.log(`    resume:    ${resume}`);
  console.log(`    dry-run:   ${dryRun}`);
}

/** Print one progress line per stage end (ANCHOR §8.3). */
function printStageProgress(info: {
  stage: keyof typeof STAGE_TITLES;
  status: 'success' | 'failed';
  durationMs: number;
  manifest: { costs: { firecrawl_calls: number; llm_input_tokens: number; llm_output_tokens: number } };
  skipped: boolean;
}): void {
  const num = STAGE_NUMBER[info.stage];
  const title = STAGE_TITLES[info.stage];
  const elapsed = (info.durationMs / 1000).toFixed(1) + 's';
  const skip = info.skipped ? ' (skipped — already complete)' : '';
  if (info.status === 'failed') {
    console.log(`✗ Stage ${num}: ${title} — failed after ${elapsed}`);
    return;
  }
  let detail = '';
  if (info.stage === 'crawl') detail = `, ${info.manifest.costs.firecrawl_calls} sources`;
  if (info.stage === 'brief')
    detail = `, ${info.manifest.costs.llm_input_tokens} in / ${info.manifest.costs.llm_output_tokens} out tokens`;
  console.log(`✓ Stage ${num}: ${title}${detail}, ${elapsed}${skip}`);
}

/** Format the Failure Report (matches BUILD_INSTRUCTIONS failure format, ANCHOR §8.3). */
function printFailureReport(args: {
  failedStage: keyof typeof STAGE_TITLES;
  error: string;
  manifestPath: string;
  retryHint: string;
}): void {
  const num = STAGE_NUMBER[args.failedStage];
  const title = STAGE_TITLES[args.failedStage];
  const oneLineErr = args.error.split('\n')[0];
  console.log('═══════════════════════════════════════════════');
  console.log('⛔ RUN FAILURE REPORT');
  console.log('═══════════════════════════════════════════════');
  console.log(`❌ FAILED:    Stage ${num} — ${title}`);
  console.log(`🔍 FAILURE:   ${oneLineErr}`);
  console.log(`🧪 VERIFIED:  Fail — manifest.stages.${args.failedStage}.status === "failed"`);
  console.log(`💡 DIAGNOSIS: ${oneLineErr}`);
  console.log(`🔧 SUGGESTED FIX: ${STAGE_FIX_HINTS[args.failedStage]}`);
  console.log('');
  console.log('🔄 RETRY PROMPT:');
  console.log('─────────────────────────────────────────');
  console.log(args.retryHint);
  console.log('─────────────────────────────────────────');
  console.log(`📂 Manifest: ${args.manifestPath}`);
  console.log('═══════════════════════════════════════════════');
}

interface DefaultOpts {
  prompt?: string;
  client?: string;
  mode?: string;
  urls?: string;
  template?: string;
  model?: string;
  name?: string;
  maxPages?: string;
  resume?: boolean;
  dryRun?: boolean;
}

/** Default-command action: parse, resolve, validate, then run the orchestrator. */
async function cmdDefault(opts: DefaultOpts): Promise<void> {
  // Required flags.
  if (!opts.prompt) throw new Error('--prompt is required');
  if (!opts.client) throw new Error('--client is required');

  ensureRequiredEnv();

  // Pricing freshness warning (ANCHOR §5.3).
  const stamp = readPricingStamp();
  if (!stamp) {
    console.warn('warn: src/config/pricing.ts not found or missing validation stamp — costs will record as $0.');
  } else if (stamp.ageDays > 90) {
    console.warn(
      `warn: pricing.ts validation stamp is ${stamp.ageDays} days old (validated ${stamp.date}). Refresh rates and update the stamp.`,
    );
  }

  // Load client profile.
  const profilePath = join(CLIENTS_DIR, opts.client, 'profile.md');
  if (!existsSync(profilePath)) {
    throw new Error(`client "${opts.client}" not found: no profile at ${profilePath}`);
  }
  const clientProfile: ClientProfile = parseClientProfile(await readFile(profilePath, 'utf8'));

  // Mode + urls.
  const mode: Mode = (opts.mode ?? 'agent') as Mode;
  if (mode !== 'agent' && mode !== 'targeted') {
    throw new Error(`--mode must be "agent" or "targeted" (got "${opts.mode}")`);
  }
  let urls: string[] | undefined;
  if (mode === 'targeted') {
    if (!opts.urls) throw new Error('--urls is required when --mode is "targeted"');
    urls = opts.urls.split(',').map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) throw new Error('--urls must list at least one URL');
  }

  // Template resolution: CLI flag → client default → "market-intelligence".
  let template: string;
  let templateNote: string;
  if (opts.template) {
    template = opts.template;
    templateNote = 'from --template flag';
  } else if (clientProfile.default_template) {
    template = clientProfile.default_template;
    templateNote = `from client profile default_template`;
  } else {
    template = 'market-intelligence';
    templateNote = 'built-in default';
  }
  const templateFile = join(TEMPLATES_DIR, `${template}.md`);
  if (!existsSync(templateFile)) {
    throw new Error(`template "${template}" not found at ${templateFile}`);
  }

  // Model.
  const model: LLMModel = (opts.model ?? 'sonnet') as LLMModel;
  if (model !== 'sonnet' && model !== 'opus') {
    throw new Error(`--model must be "sonnet" or "opus" (got "${opts.model}")`);
  }

  // Run slug derivation.
  const baseName = opts.name ? kebab(opts.name) : kebab(opts.prompt);
  const date = todayLocal();
  let runSlug = `${date}-${baseName}`;
  const runRoot = join(RUNS_DIR, clientProfile.client_slug);
  if (!opts.resume) {
    let i = 2;
    while (existsSync(join(runRoot, runSlug))) {
      runSlug = `${date}-${baseName}-${i}`;
      i++;
    }
  }

  // Optional --max-pages override (currently informational; orchestrator
  // does not enforce — Firecrawl batch caps live in env).
  if (opts.maxPages) {
    const n = Number.parseInt(opts.maxPages, 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error('--max-pages must be a positive integer');
    process.env.MAX_FIRECRAWL_PAGES_PER_RUN = String(n);
  }

  // Build & validate Job.
  const job: Job = JobSchema.parse({
    client_slug: clientProfile.client_slug,
    run_slug: runSlug,
    prompt: opts.prompt,
    mode,
    urls,
    template,
    llm_model: model,
    created_at: new Date().toISOString(),
  });

  // Instantiate clients.
  const firecrawl = new FirecrawlClient({ apiKey: process.env.FIRECRAWL_API_KEY! });
  const llm = new LLMClient({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const resend = new ResendClient({
    apiKey: process.env.RESEND_API_KEY!,
    fromEmail: process.env.RESEND_FROM_EMAIL!,
  });

  const briefName = baseName
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'Brief';

  const estimateCostUsd = await tryLoadEstimateCostUsd();

  printRunHeader({
    job,
    resolutionNotes: {
      mode: opts.mode ? 'from --mode flag' : 'default',
      template: templateNote,
      model: opts.model ? 'from --model flag' : 'default',
      name: opts.name ? 'from --name flag' : 'derived from prompt',
    },
    resume: !!opts.resume,
    dryRun: !!opts.dryRun,
  });

  let lastFailedStage: keyof typeof STAGE_TITLES | null = null;
  try {
    const manifest = await runOrchestrator({
      job,
      clientProfile,
      options: {
        resume: !!opts.resume,
        dryRun: !!opts.dryRun,
        briefName,
        clients: { firecrawl, llm, resend },
        estimateCostUsd,
        onStageEnd: (info) => {
          if (info.status !== 'success' && info.status !== 'failed') return;
          if (info.status === 'failed') lastFailedStage = info.stage;
          printStageProgress({
            stage: info.stage,
            status: info.status,
            durationMs: info.durationMs,
            manifest: info.manifest,
            skipped: info.skipped,
          });
        },
      },
    });

    const manifestPath = join('runs', job.client_slug, job.run_slug, 'manifest.json');
    if (opts.dryRun) {
      console.log(`✓ Dry run complete. ${manifest.costs.firecrawl_calls} sources in raw/. Manifest: ${manifestPath}`);
      return;
    }
    const cost = manifest.costs.estimated_usd > 0
      ? ` Cost: $${manifest.costs.estimated_usd.toFixed(2)}.`
      : '';
    console.log(
      `✓ Brief delivered to ${clientProfile.delivery_email}.${cost} Manifest: ${manifestPath}`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const manifestPath = join('runs', job.client_slug, job.run_slug, 'manifest.json');
    const retry = `npm run intel -- --resume --client ${job.client_slug} --prompt ${JSON.stringify(job.prompt)} --name ${baseName} --template ${job.template} --model ${job.llm_model}${job.mode === 'targeted' && urls ? ' --mode targeted --urls ' + urls.join(',') : ''}`;
    if (lastFailedStage) {
      printFailureReport({
        failedStage: lastFailedStage,
        error: reason,
        manifestPath,
        retryHint: retry,
      });
    } else {
      console.error(`Run failed before any stage executed: ${reason}`);
    }
    process.exit(1);
  }
}

const program = new Command();
program
  .name('intel')
  .description('Intel Orchestrator — turn a prompt into a delivered PDF brief.')
  .version('0.1.0');

program
  .command('list-clients')
  .description('List all configured clients (slug + display name).')
  .action(cmdListClients);

program
  .command('list-templates')
  .description('List all available brief templates (name + description).')
  .action(cmdListTemplates);

program
  .option('--prompt <text>', 'operator instruction (required)')
  .option('--client <slug>', 'client slug — must match clients/<slug>/ (required)')
  .option('--mode <mode>', 'crawl mode: "agent" or "targeted"', 'agent')
  .option('--urls <list>', 'comma-separated URL list (required if --mode targeted)')
  .option('--template <name>', 'brief template (default: client default_template, fallback: market-intelligence)')
  .option('--model <model>', 'LLM model: "sonnet" or "opus"', 'sonnet')
  .option('--name <slug>', 'short-name for run slug (default: derived from prompt)')
  .option('--max-pages <n>', 'override MAX_FIRECRAWL_PAGES_PER_RUN for this run')
  .option('--resume', 'skip already-completed stages for an existing run')
  .option('--dry-run', 'execute Stage 1 only — skip brief, render, deliver')
  .action(async (opts: DefaultOpts) => {
    try {
      await cmdDefault(opts);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`error: ${reason}`);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
