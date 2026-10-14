import { fakeAsync, tick } from '@angular/core/testing';

import { MessageTarget, MessageWindow, resolveExpectedOrigin, waitForAuthMessage } from './access360-handshake.service';
import { Access360Context } from './models';

const ORIGIN = 'https://access360.example.com';

class FakeWindow implements MessageWindow {
  listeners: ((event: MessageEvent) => void)[] = [];
  addEventListener(_: 'message', l: (event: MessageEvent) => void) {
    this.listeners.push(l);
  }
  removeEventListener(_: 'message', l: (event: MessageEvent) => void) {
    this.listeners = this.listeners.filter((x) => x !== l);
  }
  emit(data: unknown, origin = ORIGIN, source: unknown = target) {
    this.listeners.forEach((l) => l({ data, origin, source } as unknown as MessageEvent));
  }
}

let target: MessageTarget & { sent: { message: unknown; origin: string }[] };

describe('waitForAuthMessage', () => {
  let self: FakeWindow;
  let result: Access360Context | null | undefined;

  beforeEach(() => {
    self = new FakeWindow();
    target = { sent: [], postMessage(message, origin) { this.sent.push({ message, origin }); } };
    result = undefined;
  });

  const start = () => waitForAuthMessage(self, target, ORIGIN, 1500, 'milestone').then((r) => (result = r));

  it('sends the ready message to the expected origin', fakeAsync(() => {
    start();
    expect(target.sent).toEqual([{ message: { type: 'access360-milestone-ready' }, origin: ORIGIN }]);
    tick(1500);
  }));

  it('resolves with branchId and email from a valid reply', fakeAsync(() => {
    start();
    self.emit({ type: 'access360-milestone-auth', branchId: '12', email: 'admin@tenant.com' });
    tick();
    expect(result).toEqual({ branchId: 12, email: 'admin@tenant.com', via: 'handshake' });
    expect(self.listeners.length).toBe(0);
  }));

  it('ignores replies from another origin or window', fakeAsync(() => {
    start();
    self.emit({ type: 'access360-milestone-auth', branchId: 12, email: 'a@b.c' }, 'https://evil.example.com');
    self.emit({ type: 'access360-milestone-auth', branchId: 12, email: 'a@b.c' }, ORIGIN, {});
    tick(1500);
    expect(result).toBeNull();
  }));

  it('ignores another vendor or an invalid payload', fakeAsync(() => {
    start();
    self.emit({ type: 'access360-networkoptix-auth', branchId: 12, email: 'a@b.c' });
    self.emit({ type: 'access360-milestone-auth', branchId: -1, email: 'a@b.c' });
    self.emit({ type: 'access360-milestone-auth', branchId: 12, email: 'not-an-email' });
    tick(1500);
    expect(result).toBeNull();
  }));

  it('times out with null so the DecodeData fallback can run', fakeAsync(() => {
    start();
    tick(1499);
    expect(result).toBeUndefined();
    tick(1);
    expect(result).toBeNull();
  }));
});

describe('resolveExpectedOrigin', () => {
  it('prefers the configured origin', () => {
    expect(resolveExpectedOrigin('https://a.example.com/path', 'https://b.example.com/', 'https://c.example.com')).toBe(
      'https://a.example.com',
    );
  });

  it('uses the referrer origin, then falls back to our own origin', () => {
    expect(resolveExpectedOrigin('', 'https://b.example.com/x?y', 'https://c.example.com')).toBe('https://b.example.com');
    expect(resolveExpectedOrigin('', '', 'https://c.example.com')).toBe('https://c.example.com');
  });
});
