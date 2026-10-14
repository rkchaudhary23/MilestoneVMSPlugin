import { Injectable } from '@angular/core';

import { VmsConfiguration } from './models';
import { RuntimeConfigService } from './runtime-config.service';

/*
 * Adapter around Milestone's XProtect Mobile SDK for JavaScript (XPMobileSDK.js and its
 * Lib/ folder, shipped as static assets under assets/xpmobilesdk/). The SDK is plain
 * JavaScript that talks from the browser straight to the tenant's XProtect Mobile Server
 * over HTTP(S) and WebSocket.
 *
 * Every SDK call in the plugin goes through this file. Calls follow the SDK's documented
 * pattern (observers for connect/login, RequestStream returning a VideoConnection that
 * emits JPEG frames, playbackSpeed/playbackGoTo for playback control); when the SDK
 * version delivered by Milestone differs, only this file needs adjusting.
 */

// The SDK is untyped and attaches itself to window.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sdk = any;

declare global {
  interface Window {
    XPMobileSDK?: Sdk;
  }
}

export interface MilestoneCamera {
  id: string;
  name: string;
}

export interface MilestoneFrame {
  blob: Blob;
  timestamp: Date | null;
}

export interface StreamRequest {
  cameraId: string;
  width: number;
  height: number;
  /** Omit for live video; set to start playback at this moment. */
  playbackFrom?: Date;
}

export interface MilestoneStream {
  close(): void;
  /** Playback only: 1 = play, 0 = pause, negative = reverse. */
  setSpeed(speed: number): void;
  /** Playback only: jump to a moment in the recording. */
  goTo(time: Date): void;
}

export interface RecordedSequence {
  start: Date;
  end: Date;
}

const SDK_LOAD_TIMEOUT_MS = 15000;
const CALL_TIMEOUT_MS = 20000;

@Injectable({ providedIn: 'root' })
export class MilestoneSdkService {
  private sdkPromise: Promise<Sdk> | null = null;
  private session: { key: string; ready: Promise<void> } | null = null;

  constructor(private readonly runtimeConfig: RuntimeConfigService) {}

  /** Connects and logs in to the Mobile Server, reusing the session for the same server and user. */
  async connect(config: VmsConfiguration, forceNew = false): Promise<void> {
    const key = `${config.serverUrl}|${config.userName}|${config.loginType}`;
    if (!forceNew && this.session?.key === key) {
      return this.session.ready;
    }
    const ready = this.openSession(config);
    this.session = { key, ready };
    ready.catch(() => {
      if (this.session?.ready === ready) {
        this.session = null;
      }
    });
    return ready;
  }

  /** All cameras the Milestone user can see, de-duplicated by id. */
  async getCameras(): Promise<MilestoneCamera[]> {
    const sdk = await this.sdk();
    const result = await callWithCallbacks<unknown>((ok, fail) => sdk.getAllCameras({}, ok, fail));
    const seen = new Map<string, MilestoneCamera>();
    collectCameras(result, seen);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Opens a live or playback stream and pushes each decoded JPEG frame to onFrame. */
  async openStream(request: StreamRequest, onFrame: (frame: MilestoneFrame) => void): Promise<MilestoneStream> {
    const sdk = await this.sdk();
    const options: Record<string, unknown> = {
      SignalType: request.playbackFrom ? 'Playback' : 'Live',
      MethodType: 'Push',
    };
    if (request.playbackFrom) {
      options['SeekType'] = 'Time';
      options['Time'] = request.playbackFrom.getTime();
    }

    const connection = await callWithCallbacks<Sdk>((ok, fail) =>
      sdk.RequestStream(request.cameraId, { width: request.width, height: request.height }, options, ok, fail),
    );

    let closed = false;
    connection.addObserver({
      videoConnectionReceivedFrame: (frame: Sdk) => {
        if (closed || !frame || !frame.blob || frame.dataSize === 0) {
          return;
        }
        const timestamp = frame.timestamp ? new Date(frame.timestamp) : null;
        onFrame({ blob: frame.blob, timestamp: timestamp && !isNaN(timestamp.getTime()) ? timestamp : null });
      },
    });
    connection.open();

    return {
      close: () => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          connection.close();
          if (connection.videoId) {
            sdk.closeStream(connection.videoId);
          }
        } catch {
          // The server may already have dropped the stream.
        }
      },
      setSpeed: (speed: number) => {
        if (!closed) {
          sdk.playbackSpeed(connection, speed);
        }
      },
      goTo: (time: Date) => {
        if (!closed) {
          sdk.playbackGoTo(connection, time.getTime(), 'Time');
        }
      },
    };
  }

  /** Time of the oldest recording the Mobile Server holds for the camera, if known. */
  async getRecordingStart(cameraId: string): Promise<Date | null> {
    const sdk = await this.sdk();
    const result = await callWithCallbacks<unknown>((ok, fail) => sdk.getDBStartTime({ CameraId: cameraId }, ok, fail));
    return toDate(pickValue(result, ['Time', 'time', 'StartTime', 'startTime']));
  }

  /** Recorded sequences overlapping [from, to]. Empty means no footage in that window. */
  async getSequences(cameraId: string, from: Date, to: Date): Promise<RecordedSequence[]> {
    const sdk = await this.sdk();
    const result = await callWithCallbacks<unknown>((ok, fail) =>
      sdk.getSequencesInInterval(
        { CameraId: cameraId, StartTime: from.getTime(), EndTime: to.getTime(), SeqType: 'Recording' },
        ok,
        fail,
      ),
    );
    const list = Array.isArray(result) ? result : asArray(pickValue(result, ['Sequences', 'sequences', 'Items']));
    return list
      .map((item) => ({
        start: toDate(pickValue(item, ['StartTime', 'startTime', 'Start'])),
        end: toDate(pickValue(item, ['EndTime', 'endTime', 'End'])),
      }))
      .filter((s): s is RecordedSequence => s.start !== null && s.end !== null);
  }

  private async openSession(config: VmsConfiguration): Promise<void> {
    const sdk = await this.sdk();
    await observe(sdk, 'connectionDidConnect', 'connectionFailedToConnect', () => sdk.connect(config.serverUrl));
    await observe(sdk, 'connectionDidLogIn', 'connectionFailedToLogIn', () =>
      sdk.login(config.userName, config.password, { LoginType: config.loginType }),
    );
  }

  private sdk(): Promise<Sdk> {
    if (!this.sdkPromise) {
      this.sdkPromise = loadSdk(this.runtimeConfig.value.sdkScriptPath);
      this.sdkPromise.catch(() => (this.sdkPromise = null));
    }
    return this.sdkPromise;
  }
}

/** Injects XPMobileSDK.js once and waits for its onLoad hook, which fires after Lib/ has loaded. */
function loadSdk(src: string): Promise<Sdk> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('The Milestone SDK did not load. Check that assets/xpmobilesdk is deployed.')),
      SDK_LOAD_TIMEOUT_MS,
    );
    const done = () => {
      clearTimeout(timer);
      resolve(window.XPMobileSDK);
    };
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      const sdk = window.XPMobileSDK;
      if (!sdk) {
        clearTimeout(timer);
        reject(new Error('The Milestone SDK script loaded but did not initialise.'));
      } else if (sdk.library?.Connection) {
        done();
      } else {
        sdk.onLoad = done;
      }
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('The Milestone SDK could not be downloaded.'));
    };
    document.head.appendChild(script);
  });
}

/** Runs an SDK action and settles on the first matching observer callback. */
function observe(sdk: Sdk, success: string, failure: string, action: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const observer: Record<string, (...args: unknown[]) => void> = {
      [success]: () => settle(() => resolve()),
      [failure]: (error: unknown) => settle(() => reject(toError(error, `Milestone ${failure}`))),
    };
    const timer = setTimeout(
      () => settle(() => reject(new Error('The Milestone server did not respond in time.'))),
      CALL_TIMEOUT_MS,
    );
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      sdk.removeObserver?.(observer);
      fn();
    };
    sdk.addObserver(observer);
    try {
      action();
    } catch (error) {
      settle(() => reject(toError(error, 'Milestone SDK call failed')));
    }
  });
}

function callWithCallbacks<T>(invoke: (ok: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The Milestone server did not respond in time.')), CALL_TIMEOUT_MS);
    try {
      invoke(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(toError(error, 'Milestone request failed'));
        },
      );
    } catch (error) {
      clearTimeout(timer);
      reject(toError(error, 'Milestone SDK call failed'));
    }
  });
}

/** Walks the SDK's camera result (a flat list or a nested view tree) and collects cameras. */
function collectCameras(node: unknown, into: Map<string, MilestoneCamera>): void {
  if (Array.isArray(node)) {
    node.forEach((child) => collectCameras(child, into));
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }
  const item = node as Record<string, unknown>;
  const type = String(item['Type'] ?? item['type'] ?? '').toLowerCase();
  const id = String(item['Id'] ?? item['id'] ?? item['CameraId'] ?? '');
  const name = String(item['Name'] ?? item['name'] ?? '');
  if (id && (type === 'camera' || (!type && name))) {
    into.set(id, { id, name: name || id });
  }
  for (const key of ['Items', 'items', 'Cameras', 'cameras', 'Children']) {
    if (item[key]) {
      collectCameras(item[key], into);
    }
  }
}

function pickValue(source: unknown, keys: string[]): unknown {
  if (!source || typeof source !== 'object') {
    return source;
  }
  const obj = source as Record<string, unknown>;
  for (const key of keys) {
    if (obj[key] !== undefined) {
      return obj[key];
    }
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    return new Date(Number(value));
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    const message = obj['message'] ?? obj['ErrorString'] ?? obj['code'];
    if (message) {
      return new Error(String(message));
    }
  }
  return new Error(fallback);
}
