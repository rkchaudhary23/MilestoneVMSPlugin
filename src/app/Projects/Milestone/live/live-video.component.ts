import { Component, ElementRef, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { Access360ApiService } from '../services/access360-api.service';
import { Access360HandshakeService } from '../services/access360-handshake.service';
import { describe } from '../services/errors';
import { FrameRenderer } from '../services/frame-renderer';
import { MilestoneSdkService, MilestoneStream } from '../services/milestone-sdk.service';
import { RuntimeConfigService } from '../services/runtime-config.service';

type LiveState = 'loading' | 'playing' | 'paused' | 'error';

/** Live video for one camera, embedded as an iframe in Access360's Live page (spec §6.4). */
@Component({
  selector: 'app-live-video',
  standalone: true,
  templateUrl: './live-video.component.html',
  styleUrl: './live-video.component.css',
})
export class LiveVideoComponent implements OnInit, OnDestroy {
  @ViewChild('player', { static: true }) private player!: ElementRef<HTMLElement>;
  @ViewChild('canvas', { static: true }) private canvas!: ElementRef<HTMLCanvasElement>;

  readonly state = signal<LiveState>('loading');
  readonly message = signal('Connecting to the camera…');

  private cameraId = '';
  private stream: MilestoneStream | null = null;
  private renderer: FrameRenderer | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly handshake: Access360HandshakeService,
    private readonly api: Access360ApiService,
    private readonly sdk: MilestoneSdkService,
    private readonly runtimeConfig: RuntimeConfigService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.cameraId = this.route.snapshot.paramMap.get('cameraId') ?? '';
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
      await this.start();
    } catch (error) {
      this.fail(describe(error, 'The live video could not be loaded.'));
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stop();
  }

  async play(): Promise<void> {
    this.state.set('loading');
    this.message.set('Connecting to the camera…');
    try {
      await this.start();
    } catch (error) {
      this.fail(describe(error, 'The live video could not be loaded.'));
    }
  }

  pause(): void {
    this.stop();
    this.state.set('paused');
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void this.player.nativeElement.requestFullscreen?.();
    }
  }

  private async start(): Promise<void> {
    this.stop();
    const canvas = this.canvas.nativeElement;
    const renderer = new FrameRenderer(canvas);
    this.renderer = renderer;
    const stream = await this.sdk.openStream(
      { cameraId: this.cameraId, width: canvas.clientWidth || 1280, height: canvas.clientHeight || 720 },
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
    this.startWatchdog(renderer);
  }

  /** Turns a stream that never starts, or stops delivering frames, into a visible error. */
  private startWatchdog(renderer: FrameRenderer): void {
    const startedAt = Date.now();
    const limit = this.runtimeConfig.value.firstFrameTimeoutMs;
    this.watchdog = setInterval(() => {
      const last = renderer.lastFrameAt || startedAt;
      if (Date.now() - last > limit) {
        this.stop();
        this.fail(
          renderer.lastFrameAt
            ? 'The live video stopped. Check the camera and the Milestone server.'
            : 'The camera is not sending video.',
        );
      }
    }, 1000);
  }

  private stop(): void {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
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
