import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { Access360Context, CAM_MODE, CamDetails, VmsConfiguration } from './models';
import { field, text, toBranchId, toCamDetails, toVmsConfiguration, unwrap } from './response-mapping';
import { RuntimeConfigService } from './runtime-config.service';
import { TokenCache } from './token-cache';

/**
 * Client for the Access360 WebServices used by this plugin (spec §8). Every call except
 * the token exchange carries "Authorization: Bearer <token>"; the token is cached for
 * 10 minutes and refreshed once on a 401.
 */
@Injectable({ providedIn: 'root' })
export class Access360ApiService {
  private tokenCache?: TokenCache;

  constructor(
    private readonly http: HttpClient,
    private readonly runtimeConfig: RuntimeConfigService,
  ) {}

  /**
   * Finds the tenant's saved Milestone connection. Uses the email from the handshake when
   * there is one (spec §8.3), otherwise the branch alone (DecodeData fallback, spec §8.4).
   */
  async resolveVmsConfiguration(context: Access360Context): Promise<VmsConfiguration | null> {
    if (context.email) {
      const raw = await this.post('GetVmsConfigurationByEmail', {
        email: context.email,
        branchId: context.branchId,
      });
      return toVmsConfiguration(raw);
    }
    const raw = await this.call('GET', 'GetConfiguration', undefined, { branchId: context.branchId });
    return toVmsConfiguration(raw);
  }

  /** Saves the raw connection fields entered on the Configuration page (spec §8.4). */
  async saveConfiguration(branchId: number, config: VmsConfiguration): Promise<void> {
    await this.post('SaveConfiguration', {
      branchId,
      serverUrl: config.serverUrl,
      userName: config.userName,
      password: config.password,
      loginType: config.loginType,
    });
  }

  /** Adds (id = 0) or updates the VMS server record cameras are attached to (spec §8.6). */
  async addModVmsDetails(branchId: number, config: VmsConfiguration, userEmail: string): Promise<number> {
    const url = new URL(config.serverUrl);
    const now = new Date().toISOString();
    const raw = await this.post('AddModVMSDetails', {
      id: config.id,
      name: config.name,
      branchId,
      hostIP: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
      userName: config.userName,
      password: config.password,
      serviceURL: config.serverUrl,
      createdBy: userEmail,
      createDate: now,
      modifiedBy: userEmail,
      currentdate: now,
    });
    const saved = unwrap(raw);
    const id = saved ? Number(field(saved, 'id', 'vmsId')) : NaN;
    return Number.isInteger(id) && id > 0 ? id : config.id;
  }

  /** Saved VMS record and camera list for a branch (spec §8.7). */
  async getCamDetailsByBranchId(branchId: number): Promise<CamDetails> {
    return toCamDetails(await this.post('GetCamDetailsByBranchId', { branchId }));
  }

  /** Inserts, updates or deletes one camera record (spec §8.8). */
  async camDetailsUpdate(request: {
    mode: (typeof CAM_MODE)[keyof typeof CAM_MODE];
    id: number;
    adminId: number | null;
    branchId: number;
    vmsId: number;
    cameraId: string;
    name: string;
  }): Promise<void> {
    await this.post('CamDetailsUpdate', {
      mode: request.mode,
      id: request.id,
      adminID: request.adminId,
      branchId: request.branchId,
      vmsId: request.vmsId,
      camId: request.cameraId,
      camName: request.name,
    });
  }

  /** Legacy fallback: decodes the token Access360 put in the plugin's URL (spec §8.5). */
  async decodeData(encoded: string): Promise<number | null> {
    return toBranchId(await this.post('DecodeData', { data: encoded }));
  }

  private post(endpoint: string, body: unknown): Promise<unknown> {
    return this.call('POST', endpoint, body);
  }

  private async call(
    method: 'GET' | 'POST',
    endpoint: string,
    body?: unknown,
    params?: Record<string, string | number>,
    retried = false,
  ): Promise<unknown> {
    const token = await this.tokens().get();
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    try {
      return await firstValueFrom(
        this.http.request(method, this.url(endpoint), { body, headers, params, withCredentials: true }),
      );
    } catch (error) {
      if (!retried && error instanceof HttpErrorResponse && error.status === 401) {
        this.tokens().invalidate();
        return this.call(method, endpoint, body, params, true);
      }
      throw error;
    }
  }

  private tokens(): TokenCache {
    if (!this.tokenCache) {
      const config = this.runtimeConfig.value;
      this.tokenCache = new TokenCache(config.tokenCacheMinutes * 60_000, () => this.fetchToken());
    }
    return this.tokenCache;
  }

  /**
   * GetToken (cloud) or GetTokenjwt (on-premises), chosen by deployment config (spec §8.1–8.2).
   * The integration's credentials are handled by Access360 itself; the request relies on the
   * signed-in Access360 session that the browser sends with it.
   */
  private async fetchToken(): Promise<string> {
    const raw = await firstValueFrom(
      this.http.get<unknown>(this.url(this.runtimeConfig.value.tokenEndpoint), { withCredentials: true }),
    );
    const token = typeof raw === 'string' ? raw : text(unwrap(raw) ?? {}, 'access_token', 'accessToken', 'token');
    if (!token) {
      throw new Error('Access360 did not return an access token.');
    }
    return token;
  }

  private url(endpoint: string): string {
    const base = this.runtimeConfig.value.backendBaseUrl.replace(/\/+$/, '');
    return `${base}/WebServices/${endpoint}`;
  }
}
