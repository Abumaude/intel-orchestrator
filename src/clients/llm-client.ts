import Anthropic from '@anthropic-ai/sdk';
import type { LLMModel } from '../schemas/index.js';
import { resolveModelString } from '../config/models.js';

/** Default input token cap if `MAX_LLM_INPUT_TOKENS` is unset (matches `.env.example`). */
const DEFAULT_MAX_INPUT_TOKENS = 100_000;
/** Default output token cap if `MAX_LLM_OUTPUT_TOKENS` is unset (matches `.env.example`). */
const DEFAULT_MAX_OUTPUT_TOKENS = 8_000;

/**
 * Rough token estimate used for the input-side cap. ANCHOR §2.7 calls for a
 * cheap pre-flight check; ~4 characters per token is the standard rule of
 * thumb for English text and is intentionally conservative (over-counts).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** Arguments to `LLMClient.generateBrief`. */
export interface GenerateBriefArgs {
  systemPrompt: string;
  userMessage: string;
  model: LLMModel;
  maxOutputTokens: number;
}

/** Result of `LLMClient.generateBrief`. */
export interface GenerateBriefResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Thin wrapper around the Anthropic Messages API used by Stage 2 (Brief).
 * Enforces the operator-controlled token caps from `MAX_LLM_INPUT_TOKENS`
 * and `MAX_LLM_OUTPUT_TOKENS` (ANCHOR §2.7).
 *
 * No automatic fallback between models — if the configured model rejects
 * the request, the call fails (drift flag #9).
 */
export class LLMClient {
  private readonly anthropic: Anthropic;

  /** Construct an LLM client bound to `apiKey`. */
  constructor({ apiKey }: { apiKey: string }) {
    if (!apiKey) {
      throw new Error('LLMClient: apiKey is required');
    }
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Generate a single brief by calling the Anthropic Messages API with the
   * supplied system prompt and user message. Resolves the abstract model
   * literal (`'sonnet' | 'opus'`) to its env-controlled model string.
   *
   * Throws before the API call if estimated input tokens exceed
   * `MAX_LLM_INPUT_TOKENS`, or if `maxOutputTokens` exceeds
   * `MAX_LLM_OUTPUT_TOKENS`. Throws after the API call with the model name
   * and a one-line reason on any API failure (ANCHOR §6.1, §6.3).
   */
  async generateBrief(args: GenerateBriefArgs): Promise<GenerateBriefResult> {
    const { systemPrompt, userMessage, model, maxOutputTokens } = args;
    const resolvedModel = resolveModelString(model);

    const inputCap = readPositiveIntEnv('MAX_LLM_INPUT_TOKENS', DEFAULT_MAX_INPUT_TOKENS);
    const outputCap = readPositiveIntEnv('MAX_LLM_OUTPUT_TOKENS', DEFAULT_MAX_OUTPUT_TOKENS);

    const estimatedInput = estimateTokens(systemPrompt) + estimateTokens(userMessage);
    if (estimatedInput > inputCap) {
      throw new Error(
        `LLMClient.generateBrief (${resolvedModel}): estimated input ${estimatedInput} tokens exceeds MAX_LLM_INPUT_TOKENS=${inputCap}`,
      );
    }

    if (!Number.isFinite(maxOutputTokens) || maxOutputTokens <= 0) {
      throw new Error(
        `LLMClient.generateBrief (${resolvedModel}): maxOutputTokens must be a positive integer`,
      );
    }
    if (maxOutputTokens > outputCap) {
      throw new Error(
        `LLMClient.generateBrief (${resolvedModel}): requested maxOutputTokens=${maxOutputTokens} exceeds MAX_LLM_OUTPUT_TOKENS=${outputCap}`,
      );
    }

    let response;
    try {
      response = await this.anthropic.messages.create({
        model: resolvedModel,
        max_tokens: maxOutputTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`LLMClient.generateBrief (${resolvedModel}) failed: ${reason}`);
    }

    const text = response.content
      .filter((block): block is { type: 'text'; text: string; citations?: unknown } =>
        block.type === 'text',
      )
      .map((block) => block.text)
      .join('');

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
