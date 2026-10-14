import { MilestoneFrame } from './milestone-sdk.service';

/**
 * Draws Milestone's JPEG frames onto a canvas, scaled to fit. Frames that arrive while
 * the previous one is still decoding are dropped, so a slow client never builds a backlog.
 */
export class FrameRenderer {
  private busy = false;
  private pending: MilestoneFrame | null = null;
  private disposed = false;
  lastFrameAt = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onTimestamp: (time: Date | null) => void = () => {},
  ) {}

  draw(frame: MilestoneFrame): void {
    if (this.disposed) {
      return;
    }
    this.lastFrameAt = Date.now();
    if (this.busy) {
      this.pending = frame;
      return;
    }
    void this.render(frame);
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
  }

  private async render(frame: MilestoneFrame): Promise<void> {
    this.busy = true;
    try {
      const bitmap = await createImageBitmap(frame.blob);
      if (!this.disposed) {
        this.paint(bitmap);
        this.onTimestamp(frame.timestamp);
      }
      bitmap.close();
    } catch {
      // A corrupt frame is skipped; the next one will repaint.
    } finally {
      this.busy = false;
      const next = this.pending;
      this.pending = null;
      if (next && !this.disposed) {
        void this.render(next);
      }
    }
  }

  private paint(bitmap: ImageBitmap): void {
    const canvas = this.canvas;
    const width = canvas.clientWidth || bitmap.width;
    const height = canvas.clientHeight || bitmap.height;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const scale = Math.min(width / bitmap.width, height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.clearRect(0, 0, width, height);
    context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }
}
