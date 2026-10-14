import { DatePipe } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { Access360ApiService } from '../services/access360-api.service';
import { Access360HandshakeService } from '../services/access360-handshake.service';
import { describe } from '../services/errors';
import { FrameRenderer } from '../services/frame-renderer';
import { MilestoneSdkService, MilestoneStream } from '../services/milestone-sdk.service';
import { RuntimeConfigService } from '../services/runtime-config.service';

type ArchiveState = 'loading' | 'playing' | 'paused' | 'out-of-range' | 'error';

/** Seconds of recording either side of the requested time that count as "footage exists". */
const RANGE_CHECK_WINDOW_MS = 60_000;
/** The timeline slider covers this much time either side of the requested moment. */
const TIMELINE_HALF_SPAN_MS = 30 * 60_000;
const DEFAULT_LOOKBACK_MS = 15 * 60_000;

/**
 * Recorded video for one camera, embedded as an iframe in Access360's Archive page (spec §6.5).
 * The target time comes from the query string: ?time=<ISO 8601 or epoch milliseconds>.
 */
@Component({
  selector: 'app-archive-video',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './archive-video.component.html',
  styleUrl: './archive-video.component.css',
})
export class ArchiveVideoComponent implements OnInit, OnDestroy {
  @ViewChild('player', { static: true }) private player!: ElementRef<HTMLElement>;
  @ViewChild('canvas', { static: true }) private canvas!: ElementRef<HTMLCanvasElement>;

  readonly state = signal<ArchiveState>('loading');
  readonly message = signal('Loading recorded video…');
  readonly requested = signal<Date>(new Date(Date.now() - DEFAULT_LOOKBACK_MS));
  readonly current = signal<Date | null>(null);
  readonly recordingStart = signal<Date | null>(null);
  readonly speed = signal(1);

  private cameraId = '';
  private stream: MilestoneStream | null = null;
  private renderer: FrameRenderer | null = null;
  private destroyed = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly handshake: Access360HandshakeService,
    private readonly api: Access360ApiService,
    private readonly sdk: MilestoneSdkService,
    private readonly runtimeConfig: RuntimeConfigService,
  ) {}

  get timelineMin(): number {
    return this.requested().getTime() - TIMELINE_HALF_SPAN_MS;
  }

  get timelineMax(): number {
    return Math.min(this.requested().getTime() + TIMELINE_HALF_SPAN_MS, Date.now());
  }

  /** Value for the datetime-local picker, in the viewer's local time. */
  get requestedInput(): string {
    const d = this.requested();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async ngOnInit(): Promise<void> {
    this.cameraId = this.route.snapshot.paramMap.get('cameraId') ?? '';
    const time = parseTime(this.route.snapshot.queryParamMap.get('time'));
    if (time) {
      this.requested.set(time);
    }
    if (!this.cameraId) {
      this.fail('No camera is linked here.');
      return;
    }
    try {
      const context = await this.handshake.resolve('iframe');
      const config = await this.api.resolveVmsConfiguration(context);
      if (!config) {
        this.fail('Milestone is not configured for this facility yet.');
        return;
      }
      await this.sdk.connect(config);
      await this.openAt(this.requested());
    } catch (error) {
      this.fail(describe(error, 'The recorded video could not be loaded.'));
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stop();
  }

  /** From the date/time picker. */
  async jumpTo(value: string): Promise<void> {
    const time = parseTime(value);
    if (!time) {
      return;
    }
    this.requested.set(time);
    await this.openAt(time);
  }

  /** From the timeline slider. Seeks inside the open stream when there is one. */
  async seek(value: string): Promise<void> {
    const time = new Date(Number(value));
    if (this.stream && (await this.hasFootageAt(time))) {
      this.stream.goTo(time);
      this.current.set(time);
      this.setSpeed(this.speed() === 0 ? 1 : this.speed());
      return;
    }
    await this.openAt(time);
  }

  step(seconds: number): void {
    const base = this.current() ?? this.requested();
    void this.seek(String(base.getTime() + seconds * 1000));
  }

  play(): void {
    this.setSpeed(1);
  }

  pause(): void {
    this.setSpeed(0);
  }

  reverse(): void {
    this.setSpeed(-1);
  }

  async goToEarliest(): Promise<void> {
    const start = this.recordingStart();
    if (start) {
      this.requested.set(start);
      await this.openAt(start);
    }
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void this.player.nativeElement.requestFullscreen?.();
    }
  }

  /**
   * Checks the camera's real recordings before playing. Milestone serves the nearest clip
   * for an out-of-range time instead of failing, which would play the wrong footage.
   */
  private async openAt(time: Date): Promise<void> {
    this.stop();
    this.state.set('loading');
    this.message.set('Loading recorded video…');
    try {
      if (!(await this.hasFootageAt(time))) {
        this.recordingStart.set(await this.sdk.getRecordingStart(this.cameraId).catch(() => null));
        this.state.set('out-of-range');
        this.message.set('There is no recorded video for this camera at the requested time.');
        return;
      }
      const canvas = this.canvas.nativeElement;
      const renderer = new FrameRenderer(canvas, (stamp) => stamp && this.current.set(stamp));
      this.renderer = renderer;
      const stream = await this.sdk.openStream(
        {
          cameraId: this.cameraId,
          width: canvas.clientWidth || 1280,
          height: canvas.clientHeight || 720,
          playbackFrom: time,
        },
        (frame) => {
          renderer.draw(frame);
          if (this.state() === 'loading') {
            this.state.set('playing');
          }
        },
      );
      if (this.destroyed || this.renderer !== renderer) {
        stream.close();
        return;
      }
      this.stream = stream;
      this.current.set(time);
      this.speed.set(1);
      stream.setSpeed(1);
      this.failIfNoFrames(renderer);
    } catch (error) {
      this.fail(describe(error, 'The recorded video could not be loaded.'));
    }
  }

  private async hasFootageAt(time: Date): Promise<boolean> {
    const from = new Date(time.getTime() - RANGE_CHECK_WINDOW_MS);
    const to = new Date(time.getTime() + RANGE_CHECK_WINDOW_MS);
    const sequences = await this.sdk.getSequences(this.cameraId, from, to);
    return sequences.some((s) => s.start.getTime() <= to.getTime() && s.end.getTime() >= from.getTime());
  }

  private failIfNoFrames(renderer: FrameRenderer): void {
    setTimeout(() => {
      if (this.renderer === renderer && !renderer.lastFrameAt) {
        this.stop();
        this.fail('The Milestone server did not send any recorded video.');
      }
    }, this.runtimeConfig.value.firstFrameTimeoutMs);
  }

  private setSpeed(speed: number): void {
    if (!this.stream) {
      return;
    }
    this.stream.setSpeed(speed);
    this.speed.set(speed);
    this.state.set(speed === 0 ? 'paused' : 'playing');
  }

  private stop(): void {
    this.stream?.close();
    this.stream = null;
    this.renderer?.dispose();
    this.renderer = null;
  }

  private fail(message: string): void {
    this.state.set('error');
    this.message.set(message);
  }
}

/** Accepts ISO 8601, a datetime-local value, or epoch milliseconds. */
export function parseTime(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value);
  return isNaN(date.getTime()) ? null : date;
}
