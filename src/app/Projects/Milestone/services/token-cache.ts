/**
 * Caches the Access360 Bearer token for a fixed lifetime (spec §8: 10 minutes) and
 * shares one in-flight request between concurrent callers.
 */
export class TokenCache {
  private token: string | null = null;
  private expiresAt = 0;
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly lifetimeMs: number,
    private readonly fetchToken: () => Promise<string>,
    private readonly now: () => number = Date.now,
  ) {}

  get(): Promise<string> {
    if (this.token && this.now() < this.expiresAt) {
      return Promise.resolve(this.token);
    }
    if (!this.inFlight) {
      this.inFlight = this.fetchToken()
        .then((token) => {
          this.token = token;
          this.expiresAt = this.now() + this.lifetimeMs;
          return token;
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  /** Drop the cached token, e.g. after a 401, so the next call fetches a fresh one. */
  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }
}
