import {
  ChannexClientError,
  ChannexError,
  ChannexNetworkError,
  ChannexServerError,
  isRetryable,
} from './errors';

export interface ChannexConfig {
  /** Sandbox: https://staging.channex.io/api/v1 — Prod: https://channex.io/api/v1 */
  baseUrl: string;
  /** Sent in the `user-api-key` header. */
  apiKey: string;
  /** Optional fetch override (for testing). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Max retry attempts for retryable errors. Default 3. */
  maxRetries?: number;
  /** Initial backoff in ms. Subsequent retries double. Default 250. */
  retryBaseMs?: number;
  /** Per-request timeout in ms. Default 15s. */
  timeoutMs?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** Body to JSON-encode. */
  body?: unknown;
  /** Query string parameters; values stringified. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Override per-request retry count (e.g. 0 to disable for non-idempotent ops). */
  retries?: number;
  signal?: AbortSignal;
}

/**
 * Low-level HTTP wrapper around Channex.io.
 *
 * Adds:
 *   - user-api-key header
 *   - JSON body + Accept handling
 *   - retry with exponential backoff on 429 / 5xx / network errors
 *   - typed errors (ChannexNetworkError, ChannexClientError, ChannexServerError)
 *   - request timeout
 *
 * Does NOT add response validation — that's done by the resource modules
 * via their Zod schemas.
 */
export class ChannexHttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly timeoutMs: number;

  constructor(config: ChannexConfig) {
    if (!config.baseUrl) throw new Error('ChannexConfig.baseUrl is required');
    if (!config.apiKey) throw new Error('ChannexConfig.apiKey is required');
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 250;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  async request<T = unknown>(opts: RequestOptions): Promise<T> {
    const method = opts.method ?? 'GET';
    const url = this.buildUrl(opts.path, opts.query);

    const maxAttempts = (opts.retries ?? this.maxRetries) + 1;

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.requestOnce<T>(method, url, opts);
      } catch (err) {
        lastErr = err;
        if (attempt >= maxAttempts || !isRetryable(err)) {
          throw err;
        }
        await sleep(this.retryBaseMs * 2 ** (attempt - 1));
      }
    }
    throw lastErr ?? new ChannexError('Unknown error');
  }

  private async requestOnce<T>(
    method: string,
    url: string,
    opts: RequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'user-api-key': this.apiKey,
      accept: 'application/json',
    };

    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: opts.signal ?? controller.signal,
      });
    } catch (err) {
      throw new ChannexNetworkError(
        err instanceof Error ? err.message : String(err),
        opts.path,
        err,
      );
    } finally {
      clearTimeout(timer);
    }

    // Parse body — JSON or text fallback
    let payload: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (res.ok) {
      return payload as T;
    }

    const message = extractErrorMessage(payload) ?? `HTTP ${res.status} ${res.statusText}`;
    const code = extractErrorCode(payload);

    if (res.status >= 500) {
      throw new ChannexServerError(message, res.status, code, payload, opts.path);
    }
    throw new ChannexClientError(message, res.status, code, payload, opts.path);
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${cleanPath}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.title === 'string') return obj.title;
    if (Array.isArray(obj.errors) && obj.errors.length > 0) {
      const first = obj.errors[0];
      if (first && typeof first === 'object') {
        const msg = (first as Record<string, unknown>).message ?? (first as Record<string, unknown>).title;
        if (typeof msg === 'string') return msg;
      }
    }
    if (obj.error && typeof obj.error === 'object') {
      const e = obj.error as Record<string, unknown>;
      if (typeof e.message === 'string') return e.message;
      if (typeof e.title === 'string') return e.title;
    }
  }
  return undefined;
}

function extractErrorCode(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.code === 'string') return obj.code;
    if (obj.error && typeof obj.error === 'object') {
      const e = obj.error as Record<string, unknown>;
      if (typeof e.code === 'string') return e.code;
    }
  }
  return undefined;
}
