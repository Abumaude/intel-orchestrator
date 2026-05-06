import FirecrawlApp from '@mendable/firecrawl-js';

/**
 * One source produced by a Firecrawl call: the URL the content came from and
 * the markdown body for it. Stage 1 writes one file per source into `raw/`
 * (ANCHOR §2.2).
 */
export interface FirecrawlSource {
  url: string;
  content: string;
}

/**
 * Result of `runAgent`. `result` is Firecrawl's synthesised text answer;
 * `sources` is the list of underlying pages, each carrying its URL and
 * markdown content (ANCHOR §5.1).
 */
export interface AgentResult {
  result: string;
  sources: FirecrawlSource[];
}

/**
 * Thin wrapper around the official Firecrawl SDK exposing only the two
 * endpoints in scope for v1: the `/v2/agent` endpoint for `agent` mode and
 * the batch-scrape endpoint for `targeted` mode (ANCHOR §5.1, drift flag #4).
 *
 * No other Firecrawl endpoints are reachable through this wrapper.
 */
export class FirecrawlClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly app: FirecrawlApp;

  /** Construct a Firecrawl client bound to `apiKey`. Uses the default hosted API base. */
  constructor({ apiKey }: { apiKey: string }) {
    if (!apiKey) {
      throw new Error('FirecrawlClient: apiKey is required');
    }
    this.apiKey = apiKey;
    this.app = new FirecrawlApp({ apiKey });
    this.apiUrl = this.app.apiUrl || 'https://api.firecrawl.dev';
  }

  /**
   * Call the `/v2/agent` endpoint with a natural-language prompt. Firecrawl
   * decides which sources to visit and returns a synthesised answer alongside
   * the underlying pages. The response is normalised so each source carries
   * both `url` and markdown `content` (ANCHOR §5.1).
   *
   * Throws with the endpoint URL and HTTP status on any non-2xx response.
   */
  async runAgent(prompt: string): Promise<AgentResult> {
    const endpoint = `${this.apiUrl.replace(/\/$/, '')}/v2/agent`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ prompt }),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Firecrawl agent request to ${endpoint} failed (network error): ${reason}`);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(
        `Firecrawl agent request to ${endpoint} failed with HTTP ${response.status} ${response.statusText}: ${bodyText.slice(0, 500)}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Firecrawl agent response from ${endpoint} was not valid JSON: ${reason}`);
    }

    const data = payload as {
      result?: unknown;
      sources?: unknown;
      data?: { result?: unknown; sources?: unknown };
    };
    const root = data.data ?? data;
    const result = typeof root.result === 'string' ? root.result : '';
    const rawSources = Array.isArray(root.sources) ? root.sources : [];
    const sources: FirecrawlSource[] = rawSources.map((src) => {
      const s = src as { url?: unknown; link?: unknown; content?: unknown; markdown?: unknown };
      const url = typeof s.url === 'string' ? s.url : typeof s.link === 'string' ? s.link : '';
      const content =
        typeof s.content === 'string'
          ? s.content
          : typeof s.markdown === 'string'
            ? s.markdown
            : '';
      return { url, content };
    });

    return { result, sources };
  }

  /**
   * Call the batch-scrape endpoint for an explicit URL list, requesting
   * markdown only. The SDK polls until the job is complete and returns one
   * document per URL (ANCHOR §5.1).
   *
   * Throws with the offending URL list and HTTP status on failure.
   */
  async runBatchScrape(urls: string[]): Promise<FirecrawlSource[]> {
    if (!Array.isArray(urls) || urls.length === 0) {
      throw new Error('FirecrawlClient.runBatchScrape: urls must be a non-empty array');
    }

    let response: Awaited<ReturnType<FirecrawlApp['batchScrapeUrls']>>;
    try {
      response = await this.app.batchScrapeUrls(urls, { formats: ['markdown'] });
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'statusCode' in err
          ? (err as { statusCode?: number }).statusCode
          : undefined;
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Firecrawl batch-scrape failed for [${urls.join(', ')}] (HTTP ${status ?? 'n/a'}): ${reason}`,
      );
    }

    if (!response.success) {
      throw new Error(
        `Firecrawl batch-scrape failed for [${urls.join(', ')}]: ${response.error}`,
      );
    }

    return response.data.map((doc) => ({
      url: typeof doc.url === 'string' ? doc.url : (doc.metadata?.sourceURL ?? ''),
      content: typeof doc.markdown === 'string' ? doc.markdown : '',
    }));
  }

  /**
   * Count the number of pages/sources in either supported response shape.
   * Used by the orchestrator to record Firecrawl page count for cost
   * tracking in `manifest.json` (ANCHOR §2.7).
   */
  static pageCount(result: AgentResult | FirecrawlSource[]): number {
    if (Array.isArray(result)) return result.length;
    return result.sources.length;
  }
}
