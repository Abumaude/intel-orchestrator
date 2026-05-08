import type { LLMModel } from '../schemas/index.js';

/**
 * Default Anthropic model strings used when the corresponding env var is
 * unset. Operator-controlled per ANCHOR §6.1 — never auto-resolved by the CLI.
 */
const DEFAULT_SONNET = 'claude-sonnet-4-6';
const DEFAULT_OPUS = 'claude-opus-4-7';

/**
 * Map of `LLMModel` literal → resolved Anthropic model string. Reads
 * `LLM_MODEL_SONNET` and `LLM_MODEL_OPUS` from `process.env` with the v1
 * defaults baked in (ANCHOR §6.1).
 */
export const MODEL_STRINGS: Record<LLMModel, string> = {
  sonnet: process.env.LLM_MODEL_SONNET || DEFAULT_SONNET,
  opus: process.env.LLM_MODEL_OPUS || DEFAULT_OPUS,
};

/**
 * Resolve an `LLMModel` literal to the concrete model string sent to the
 * Anthropic API. The caller controls the choice; there is no automatic
 * fallback between models (drift flag #9).
 */
export function resolveModelString(model: LLMModel): string {
  return MODEL_STRINGS[model];
}
