import { Injectable } from '@angular/core';

/**
 * Deploy-time settings. Loaded once at startup from assets/config.json, which the
 * container writes from environment variables (see docker/40-runtime-config.sh) or
 * which Kubernetes mounts from a ConfigMap. Nothing environment-specific is hard-coded
 * in source (spec §10.2).
 */
export interface RuntimeConfig {
  /** Access360 backend root. Empty string = same origin as the plugin (spec §4.1). */
  backendBaseUrl: string;
  /** 'GetToken' for cloud deployments, 'GetTokenjwt' for on-premises (spec §8.1–8.2). */
  tokenEndpoint: 'GetToken' | 'GetTokenjwt';
  /** Bearer token cache lifetime (spec §8: 10 minutes). */
  tokenCacheMinutes: number;
  /**
   * Origin that is allowed to answer the postMessage handshake. Empty = derive it from
   * document.referrer, falling back to this page's own origin (same-origin deployment).
   */
  access360Origin: string;
  /** How long to wait for Access360's auth reply before the DecodeData fallback (spec §4.3). */
  handshakeTimeoutMs: number;
  /** Query-string parameter that carries the legacy encoded token for DecodeData. */
  decodeDataQueryParam: string;
  /** Location of the Milestone XProtect Mobile SDK entry script, relative to the base href. */
  sdkScriptPath: string;
  /** Show an error if no video frame arrives within this time (spec UC-02 load time). */
  firstFrameTimeoutMs: number;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  backendBaseUrl: '',
  tokenEndpoint: 'GetToken',
  tokenCacheMinutes: 10,
  access360Origin: '',
  handshakeTimeoutMs: 1500,
  decodeDataQueryParam: 'data',
  sdkScriptPath: 'assets/xpmobilesdk/XPMobileSDK.js',
  firstFrameTimeoutMs: 10000,
};

@Injectable({ providedIn: 'root' })
export class RuntimeConfigService {
  private config: RuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG };

  get value(): RuntimeConfig {
    return this.config;
  }

  async load(): Promise<void> {
    try {
      const response = await fetch('assets/config.json', { cache: 'no-store' });
      if (response.ok) {
        const loaded = (await response.json()) as Partial<RuntimeConfig>;
        this.config = { ...DEFAULT_RUNTIME_CONFIG, ...loaded };
      }
    } catch {
      // Keep the defaults; they target a same-origin cloud deployment.
    }
    if (this.config.tokenEndpoint !== 'GetToken' && this.config.tokenEndpoint !== 'GetTokenjwt') {
      this.config.tokenEndpoint = 'GetToken';
    }
  }
}
