/**
 * Typed errors thrown by the Channex client.
 *
 * Callers should check `err instanceof ChannexError` and look at `status` /
 * `code` to decide how to react (retry, alert, ignore).
 */

export class ChannexError extends Error {
  public override readonly name: string = 'ChannexError';
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly payload?: unknown,
    public readonly path?: string,
  ) {
    super(message);
  }
}

/** Network-level failure (DNS, ECONNRESET, timeout, etc.). */
export class ChannexNetworkError extends ChannexError {
  public override readonly name = 'ChannexNetworkError';
  public override readonly cause?: unknown;
  constructor(message: string, path?: string, cause?: unknown) {
    super(message, undefined, 'NETWORK', undefined, path);
    this.cause = cause;
  }
}

/** 4xx response — the request was invalid (bad payload, missing IDs, auth). */
export class ChannexClientError extends ChannexError {
  public override readonly name = 'ChannexClientError';
}

/** 5xx response — Channex side is having problems. Worth retrying. */
export class ChannexServerError extends ChannexError {
  public override readonly name = 'ChannexServerError';
}

/** Determines whether an error is worth retrying. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ChannexNetworkError) return true;
  if (err instanceof ChannexServerError) return true;
  if (err instanceof ChannexError && err.status === 429) return true;
  return false;
}
