import { RateLimitError } from "./errors/rate-limit.error.js";

interface RateLimitBucket {
  count: number;
  expiresAt: number;
}

export interface OperationRateLimit {
  maxCalls: number;
  windowMs: number;
}

interface RateLimitOptions extends OperationRateLimit {
  now?: (() => number) | undefined;
  policyForOperation?: ((operation: string) => OperationRateLimit | undefined) | undefined;
  cleanupInterval?: number | undefined;
}

interface SharedRateLimitState {
  buckets: Map<string, RateLimitBucket>;
  consumptions: number;
}

export class ToolRateLimiter {
  private readonly now: () => number;
  private readonly state: SharedRateLimitState;

  constructor(
    private readonly options: RateLimitOptions,
    private readonly scope = "global",
    state?: SharedRateLimitState,
  ) {
    this.now = options.now ?? Date.now;
    this.state = state ?? { buckets: new Map(), consumptions: 0 };
  }

  forScope(scope: string): ToolRateLimiter {
    return new ToolRateLimiter(
      this.options,
      JSON.stringify([this.scope, scope]),
      this.state,
    );
  }

  consume(operation: string): void {
    const now = this.now();
    this.state.consumptions += 1;
    if (this.state.consumptions % (this.options.cleanupInterval ?? 100) === 0) {
      this.deleteExpiredBuckets(now);
    }

    const policy = this.options.policyForOperation?.(operation) ?? this.options;
    const key = JSON.stringify([this.scope, operation]);
    const bucket = this.state.buckets.get(key);

    if (!bucket || bucket.expiresAt <= now) {
      this.state.buckets.set(key, {
        count: 1,
        expiresAt: now + policy.windowMs,
      });
      return;
    }

    if (bucket.count >= policy.maxCalls) {
      throw new RateLimitError(Math.max(1, bucket.expiresAt - now));
    }
    bucket.count += 1;
  }

  private deleteExpiredBuckets(now: number): void {
    for (const [key, bucket] of this.state.buckets) {
      if (bucket.expiresAt <= now) this.state.buckets.delete(key);
    }
  }
}
