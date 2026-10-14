import { TokenCache } from './token-cache';

describe('TokenCache', () => {
  let now: number;
  let calls: number;
  let cache: TokenCache;

  beforeEach(() => {
    now = 0;
    calls = 0;
    cache = new TokenCache(10 * 60_000, async () => `token-${++calls}`, () => now);
  });

  it('reuses the token for 10 minutes, then fetches a new one', async () => {
    expect(await cache.get()).toBe('token-1');
    now = 10 * 60_000 - 1;
    expect(await cache.get()).toBe('token-1');
    now = 10 * 60_000;
    expect(await cache.get()).toBe('token-2');
  });

  it('shares one request between concurrent callers', async () => {
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect([a, b]).toEqual(['token-1', 'token-1']);
    expect(calls).toBe(1);
  });

  it('fetches again after invalidate', async () => {
    await cache.get();
    cache.invalidate();
    expect(await cache.get()).toBe('token-2');
  });
});
