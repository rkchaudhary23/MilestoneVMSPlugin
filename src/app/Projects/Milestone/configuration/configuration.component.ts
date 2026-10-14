import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';

import { Access360ApiService } from '../services/access360-api.service';
import { Access360HandshakeService } from '../services/access360-handshake.service';
import { describe } from '../services/errors';
import { MilestoneSdkService } from '../services/milestone-sdk.service';
import { Access360Context, CAM_MODE, MilestoneLoginType, SavedCamera, VmsConfiguration } from '../services/models';

export type SyncStatus = 'new' | 'renamed' | 'unchanged' | 'removed';

export interface CameraRow {
  cameraId: string;
  name: string;
  savedId: number;
  status: SyncStatus;
}

interface Notice {
  kind: 'success' | 'warning' | 'error' | 'info';
  text: string;
}

/**
 * One-time (per tenant) setup, opened by the Tenant Admin in a new browser tab from
 * Access360's Integrations screen (spec §6.3): connect the tenant's XProtect Mobile Server
 * and sync its cameras into Access360.
 */
@Component({
  selector: 'app-configuration',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './configuration.component.html',
  styleUrl: './configuration.component.css',
})
export class ConfigurationComponent implements OnInit {
  readonly form = inject(FormBuilder).nonNullable.group({
    serverUrl: ['', [Validators.required, serverUrlValidator]],
    userName: ['', [Validators.required, Validators.maxLength(256)]],
    password: ['', [Validators.required, Validators.maxLength(256)]],
    loginType: ['Basic' as MilestoneLoginType, Validators.required],
  });

  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly notice = signal<Notice | null>({ kind: 'info', text: 'Loading the saved configuration…' });
  readonly rows = signal<CameraRow[]>([]);
  readonly pendingChanges = computed(() => this.rows().filter((r) => r.status !== 'unchanged').length);

  private context: Access360Context | null = null;
  private vmsId = 0;
  private adminId: number | null = null;
  private saved: SavedCamera[] = [];

  constructor(
    private readonly handshake: Access360HandshakeService,
    private readonly api: Access360ApiService,
    private readonly sdk: MilestoneSdkService,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      this.context = await this.handshake.resolve('tab');
      const [config, details] = await Promise.all([
        this.api.resolveVmsConfiguration(this.context),
        this.api.getCamDetailsByBranchId(this.context.branchId),
      ]);
      this.adminId = details.adminId;
      this.saved = details.cameras;
      const existing = config ?? details.vms;
      if (existing) {
        this.vmsId = existing.id || details.vms?.id || 0;
        this.form.patchValue({
          serverUrl: existing.serverUrl,
          userName: existing.userName,
          password: existing.password,
          loginType: existing.loginType,
        });
      }
      this.rows.set(this.saved.map((c) => ({ cameraId: c.cameraId, name: c.name, savedId: c.id, status: 'unchanged' })));
      this.ready.set(true);
      this.notice.set(
        existing
          ? { kind: 'info', text: `Milestone is connected with ${this.saved.length} camera(s) synced to Access360.` }
          : { kind: 'info', text: 'Enter your XProtect Mobile Server details to connect Milestone.' },
      );
    } catch (error) {
      this.notice.set({ kind: 'error', text: describe(error, 'The configuration could not be loaded.') });
    }
  }

  async testConnection(): Promise<void> {
    if (!this.validate()) {
      return;
    }
    await this.run('Connecting to the Milestone server…', async () => {
      await this.sdk.connect(this.currentConfig(), true);
      this.notice.set({ kind: 'success', text: 'Connected to the Milestone server.' });
    });
  }

  /** Verifies the login, saves it to Access360, then loads the camera list for syncing. */
  async save(): Promise<void> {
    if (!this.validate() || !this.context) {
      return;
    }
    const context = this.context;
    await this.run('Saving…', async () => {
      const config = this.currentConfig();
      await this.sdk.connect(config, true);
      this.vmsId = await this.api.addModVmsDetails(context.branchId, config, context.email);
      await this.api.saveConfiguration(context.branchId, { ...config, id: this.vmsId });
      await this.loadCameras();
    });
  }

  async fetchCameras(): Promise<void> {
    if (!this.validate()) {
      return;
    }
    await this.run('Reading cameras from the Milestone server…', async () => {
      await this.sdk.connect(this.currentConfig());
      await this.loadCameras();
    });
  }

  /** Writes every pending change with one CamDetailsUpdate call per camera (spec §8.8). */
  async sync(): Promise<void> {
    if (!this.context) {
      return;
    }
    if (!this.vmsId) {
      this.notice.set({ kind: 'warning', text: 'Save the server details before syncing cameras.' });
      return;
    }
    const context = this.context;
    const changes = this.rows().filter((r) => r.status !== 'unchanged');
    await this.run('Syncing cameras to Access360…', async () => {
      const failed: string[] = [];
      for (const row of changes) {
        const mode =
          row.status === 'new' ? CAM_MODE.insert : row.status === 'removed' ? CAM_MODE.delete : CAM_MODE.update;
        try {
          await this.api.camDetailsUpdate({
            mode,
            id: row.savedId,
            adminId: this.adminId,
            branchId: context.branchId,
            vmsId: this.vmsId,
            cameraId: row.cameraId,
            name: row.name,
          });
        } catch {
          failed.push(row.name);
        }
      }
      const details = await this.api.getCamDetailsByBranchId(context.branchId);
      this.saved = details.cameras;
      this.adminId = details.adminId ?? this.adminId;
      this.rows.set(diffCameras(this.rows().filter((r) => r.status !== 'removed'), this.saved));
      this.notice.set(
        failed.length
          ? { kind: 'warning', text: `${failed.length} camera(s) could not be synced: ${failed.join(', ')}. Try again.` }
          : { kind: 'success', text: `Cameras synced. ${this.saved.length} camera(s) are now available in Access360.` },
      );
    });
  }

  hasError(control: 'serverUrl' | 'userName' | 'password'): boolean {
    const c = this.form.controls[control];
    return c.invalid && (c.touched || c.dirty);
  }

  private async loadCameras(): Promise<void> {
    const cameras = await this.sdk.getCameras();
    this.rows.set(diffCameras(cameras.map((c) => ({ cameraId: c.id, name: c.name })), this.saved));
    const pending = this.pendingChanges();
    this.notice.set(
      cameras.length === 0
        ? { kind: 'warning', text: 'The Milestone server returned no cameras for this user.' }
        : pending
          ? { kind: 'info', text: `Found ${cameras.length} camera(s). ${pending} change(s) to sync to Access360.` }
          : { kind: 'success', text: `Found ${cameras.length} camera(s). Access360 is already up to date.` },
    );
  }

  private validate(): boolean {
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.notice.set({ kind: 'error', text: 'Correct the highlighted fields.' });
      return false;
    }
    return true;
  }

  private currentConfig(): VmsConfiguration {
    const value = this.form.getRawValue();
    return {
      id: this.vmsId,
      name: 'Milestone XProtect',
      serverUrl: value.serverUrl.trim().replace(/\/+$/, ''),
      userName: value.userName.trim(),
      password: value.password,
      loginType: value.loginType,
    };
  }

  private async run(progress: string, action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.notice.set({ kind: 'info', text: progress });
    try {
      await action();
    } catch (error) {
      this.notice.set({ kind: 'error', text: describe(error, 'The request failed. Check the server details.') });
    } finally {
      this.busy.set(false);
    }
  }
}

/** Compares the cameras on the Milestone server with those saved in Access360. */
export function diffCameras(fromVms: { cameraId: string; name: string }[], saved: SavedCamera[]): CameraRow[] {
  const savedById = new Map(saved.map((c) => [c.cameraId.toLowerCase(), c]));
  const rows: CameraRow[] = fromVms.map((camera) => {
    const match = savedById.get(camera.cameraId.toLowerCase());
    savedById.delete(camera.cameraId.toLowerCase());
    return {
      cameraId: camera.cameraId,
      name: camera.name,
      savedId: match?.id ?? 0,
      status: !match ? 'new' : match.name === camera.name ? 'unchanged' : 'renamed',
    };
  });
  for (const removed of savedById.values()) {
    rows.push({ cameraId: removed.cameraId, name: removed.name, savedId: removed.id, status: 'removed' });
  }
  return rows;
}

/** Requires an absolute http(s) URL, and https when the page itself is served over https. */
export function serverUrlValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = (control.value ?? '').trim();
  if (!value) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { url: true };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { url: true };
  }
  if (url.protocol === 'http:' && typeof location !== 'undefined' && location.protocol === 'https:') {
    return { insecure: true };
  }
  return null;
}
