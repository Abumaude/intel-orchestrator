import { z } from 'zod';
import yaml from 'js-yaml';

/**
 * Crawl mode for Stage 1. `agent` lets Firecrawl pick sources from a prompt;
 * `targeted` calls Firecrawl batch-scrape on an explicit URL list (ANCHOR §2.2).
 */
export const ModeSchema = z.enum(['agent', 'targeted']);
/** Literal union for the supported crawl modes (ANCHOR §2.2). */
export type Mode = z.infer<typeof ModeSchema>;

/**
 * LLM model selector. Maps to a concrete model string via `src/config/models.ts`
 * (ANCHOR §6.1). v1 supports Sonnet (default) and Opus only.
 */
export const LLMModelSchema = z.enum(['sonnet', 'opus']);
/** Literal union for the supported LLM models (ANCHOR §6.1). */
export type LLMModel = z.infer<typeof LLMModelSchema>;

/**
 * Lifecycle status of a single pipeline stage as recorded in `manifest.json`
 * (ANCHOR §3.4).
 */
export const StageStatusSchema = z.enum(['pending', 'running', 'success', 'failed']);
/** Literal union for stage lifecycle status (ANCHOR §3.4). */
export type StageStatus = z.infer<typeof StageStatusSchema>;

/**
 * Per-stage record stored under `manifest.stages.{crawl,brief,render,deliver}`.
 * Carries timing, error, and artefact paths so a run can be reconstructed
 * from the repo alone (ANCHOR §3.4, Principle #1).
 */
export const StageRecordSchema = z.object({
  status: StageStatusSchema,
  started_at: z.string().optional(),
  ended_at: z.string().optional(),
  error: z.string().optional(),
  artefacts: z.array(z.string()).optional(),
});
/** TypeScript type for a single stage record in the manifest (ANCHOR §3.4). */
export type StageRecord = z.infer<typeof StageRecordSchema>;

/**
 * Immutable description of a single run, written to `job.md` before Stage 1
 * begins and never modified thereafter (ANCHOR §3.1, §3.4). Multi-tenant by
 * default: every Job carries a `client_slug` even when there is only one client.
 */
export const JobSchema = z
  .object({
    client_slug: z.string().min(1),
    run_slug: z.string().min(1),
    prompt: z.string().min(1),
    mode: ModeSchema,
    urls: z.array(z.string().url()).optional(),
    template: z.string().min(1),
    llm_model: LLMModelSchema,
    created_at: z.string().min(1),
  })
  .refine(
    (job) => job.mode !== 'targeted' || (Array.isArray(job.urls) && job.urls.length > 0),
    { message: 'urls must be a non-empty array when mode is "targeted"', path: ['urls'] },
  );
/** TypeScript type for a Job — the immutable record of a single run (ANCHOR §3.4). */
export type Job = z.infer<typeof JobSchema>;

/**
 * Full run manifest written to `manifest.json`. Updated atomically after each
 * stage completes; the only mutable per-run artefact (ANCHOR §3.1, §3.4).
 */
export const ManifestSchema = z.object({
  job: JobSchema,
  stages: z.object({
    crawl: StageRecordSchema,
    brief: StageRecordSchema,
    render: StageRecordSchema,
    deliver: StageRecordSchema,
  }),
  costs: z.object({
    firecrawl_calls: z.number().nonnegative(),
    llm_input_tokens: z.number().nonnegative(),
    llm_output_tokens: z.number().nonnegative(),
    estimated_usd: z.number().nonnegative(),
  }),
});
/** TypeScript type for a run manifest (ANCHOR §3.4). */
export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Multi-tenant-ready client record parsed from the YAML frontmatter of
 * `clients/[slug]/profile.md` (ANCHOR §3.2, §3.4). v2 will extend this with
 * login fields without renaming any existing field.
 */
export const ClientProfileSchema = z.object({
  client_slug: z.string().min(1),
  display_name: z.string().min(1),
  delivery_email: z.string().min(1),
  default_template: z.string().min(1),
  notes: z.string().optional(),
});
/** TypeScript type for a client profile (ANCHOR §3.4). */
export type ClientProfile = z.infer<typeof ClientProfileSchema>;

/**
 * Extract the YAML frontmatter block from a `profile.md` file and validate it
 * against `ClientProfileSchema`. Throws if no frontmatter is present, the YAML
 * is malformed, or any required field is missing (ANCHOR §3.4).
 */
export function parseClientProfile(rawMarkdown: string): ClientProfile {
  const match = rawMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || match[1] === undefined) {
    throw new Error('parseClientProfile: no YAML frontmatter found (expected leading "---" block)');
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(match[1]);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`parseClientProfile: malformed YAML frontmatter — ${reason}`);
  }
  return ClientProfileSchema.parse(parsed);
}

/**
 * Serialize a `Manifest` to a pretty-printed JSON string suitable for writing
 * to `manifest.json`. Validates the input against `ManifestSchema` first so a
 * malformed manifest is never written to disk.
 */
export function serializeManifest(manifest: Manifest): string {
  const validated = ManifestSchema.parse(manifest);
  return `${JSON.stringify(validated, null, 2)}\n`;
}

/**
 * Parse a `manifest.json` payload, throwing on malformed JSON or any zod
 * validation failure. Used on `--resume` to load the prior run's state.
 */
export function parseManifest(rawJson: string): Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`parseManifest: malformed JSON — ${reason}`);
  }
  return ManifestSchema.parse(parsed);
}
