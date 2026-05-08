// Validated: 2026-05-06
//
// All rates below were sighted on the date above. The CLI emits a startup
// warning when this stamp is more than 90 days old (ANCHOR §5.3). Update
// the stamp on the same commit that updates any rate constant.

import type { LLMModel } from '../schemas/index.js';

/**
 * Per-page Firecrawl cost in USD. Approximation based on the published
 * mid-tier hosted plan ($99 / 100,000 credits ≈ $0.001/credit, with one
 * page ≈ one credit on `agent` and `batch/scrape` endpoints used in v1).
 * Source: https://www.firecrawl.dev/pricing
 */
export const FIRECRAWL_PER_PAGE_USD = 0.001;

/**
 * Anthropic per-million-token rates in USD, separated by model and direction.
 * Source: https://docs.anthropic.com/en/docs/about-claude/pricing
 *
 * v1 ships only the two model literals exposed by `LLMModel`. The map is
 * keyed by literal so a future model addition is a one-line change.
 */
export const ANTHROPIC_RATES_PER_MTOK_USD: Record<LLMModel, { input: number; output: number }> = {
  // Claude Sonnet (4-class): mid-cost workhorse — used for nearly all briefs.
  sonnet: { input: 3.0, output: 15.0 },
  // Claude Opus (4-class): stronger synthesis at ~5× the cost — used on
  // high-stakes briefs the operator opts into via `--model opus`.
  opus: { input: 15.0, output: 75.0 },
};

/** Arguments to `estimateCostUsd`. */
export interface EstimateCostArgs {
  firecrawlPages: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  model: LLMModel;
}

/**
 * Estimate the total USD cost of a single run from the per-stage counts
 * recorded in `manifest.json`. Returns the sum of Firecrawl and Anthropic
 * components, rounded to four decimal places so per-page costs (~$0.001)
 * remain visible. The CLI rounds further for human display.
 */
export function estimateCostUsd(args: EstimateCostArgs): number {
  const { firecrawlPages, llmInputTokens, llmOutputTokens, model } = args;
  const firecrawlCost = firecrawlPages * FIRECRAWL_PER_PAGE_USD;
  const rate = ANTHROPIC_RATES_PER_MTOK_USD[model];
  const llmCost =
    (llmInputTokens / 1_000_000) * rate.input + (llmOutputTokens / 1_000_000) * rate.output;
  const total = firecrawlCost + llmCost;
  return Math.round(total * 10_000) / 10_000;
}
