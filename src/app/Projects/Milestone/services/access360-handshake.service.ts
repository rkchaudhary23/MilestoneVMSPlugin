import { Injectable } from '@angular/core';

import { Access360ApiService } from './access360-api.service';
import { Access360Context, VENDOR_KEY } from './models';
import { RuntimeConfigService } from './runtime-config.service';

/** Minimal window surface used by the handshake, so it can be unit tested without a browser frame. */
export interface MessageWindow {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface MessageTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

/**
 * Sends { type: 'access360-<vendor>-ready' } to the Access360 window and waits for
 * { type: 'access360-<vendor>-auth', branchId, email } (spec §4.3). Replies from any other
 * origin or window, or with an invalid payload, are ignored. Resolves null on timeout.
 */
export function waitForAuthMessage(
  self: MessageWindow,
  target: MessageTarget,
  expectedOrigin: string,
  timeoutMs: number,
  vendorKey = VENDOR_KEY,
): Promise<Access360Context | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;

    const finish = (context: Access360Context | null) => {
      clearTimeout(timer);
      self.removeEventListener('message', onMessage);
      resolve(context);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin || event.source !== (target as unknown)) {
        return;
      }
      const data = event.data as { type?: unknown; branchId?: unknown; email?: unknown } | null;
      if (!data || data.type !== `access360-${vendorKey}-auth`) {
        return;
      }
      const branchId = Number(data.branchId);
      const email = typeof data.email === 'string' ? data.email.trim() : '';
      if (!Number.isInteger(branchId) || branchId <= 0 || !EMAIL_PATTERN.test(email)) {
        return;
      }
      finish({ branchId, email, via: 'handshake' });
    };

    self.addEventListener('message', onMessage);
    timer = setTimeout(() => finish(null), timeoutMs);
    target.postMessage({ type: `access360-${vendorKey}-ready` }, expectedOrigin);
  });
}

/** Origin allowed to answer: configured value, else the referrer's origin, else our own origin. */
export function resolveExpectedOrigin(configured: string, referrer: string, ownOrigin: string): string {
  if (configured) {
    return new URL(configured).origin;
  }
  if (referrer) {
    try {
      return new URL(referrer).origin;
    } catch {
      // Fall through to the same-origin default.
    }
  }
  return ownOrigin;
}

@Injectable({ providedIn: 'root' })
export class Access360HandshakeService {
  constructor(
    private readonly runtimeConfig: RuntimeConfigService,
    private readonly api: Access360ApiService,
  ) {}

  /**
   * Resolves who is using the plugin. Configuration opens in a new tab and talks to
   * window.opener; Live and Archive are iframes and talk to window.parent (spec §4.3).
   */
  async resolve(openedAs: 'tab' | 'iframe'): Promise<Access360Context> {
    const config = this.runtimeConfig.value;
    const target = openedAs === 'tab' ? window.opener : window.parent !== window ? window.parent : null;

    if (target) {
      const expectedOrigin = resolveExpectedOrigin(config.access360Origin, document.referrer, window.location.origin);
      const context = await waitForAuthMessage(window, target, expectedOrigin, config.handshakeTimeoutMs);
      if (context) {
        return context;
      }
    }
    return this.decodeDataFallback();
  }

  private async decodeDataFallback(): Promise<Access360Context> {
    const encoded = new URLSearchParams(window.location.search).get(this.runtimeConfig.value.decodeDataQueryParam);
    if (!encoded) {
      throw new Error('Open this page from Access360. No Access360 session was handed to the plugin.');
    }
    const branchId = await this.api.decodeData(encoded);
    if (branchId === null) {
      throw new Error('Access360 could not identify your facility. Reopen this page from Access360.');
    }
    return { branchId, email: '', via: 'decode-data' };
  }
}
