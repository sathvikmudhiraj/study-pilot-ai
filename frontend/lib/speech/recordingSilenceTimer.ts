export const VOICE_RECORDING_SILENCE_MS = 12_000;

type RecordingSilenceTimerOptions = {
  silenceMs?: number;
  onSilence: () => void;
};

export class RecordingSilenceTimer {
  private readonly silenceMs: number;
  private readonly onSilence: () => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private speechActive = false;
  private disposed = false;

  constructor({ silenceMs = VOICE_RECORDING_SILENCE_MS, onSilence }: RecordingSilenceTimerOptions) {
    this.silenceMs = silenceMs;
    this.onSilence = onSilence;
  }

  start() {
    if (this.disposed) return;
    this.speechActive = false;
    this.scheduleSilenceTimer();
  }

  speechStart() {
    if (this.disposed) return;
    this.speechActive = true;
    this.clearTimer();
  }

  speechActivity() {
    if (this.disposed) return;
    if (this.speechActive) {
      this.clearTimer();
      return;
    }
    this.scheduleSilenceTimer();
  }

  speechEnd() {
    if (this.disposed) return;
    this.speechActive = false;
    this.scheduleSilenceTimer();
  }

  cancel() {
    this.clearTimer();
  }

  dispose() {
    this.disposed = true;
    this.clearTimer();
  }

  private scheduleSilenceTimer() {
    this.clearTimer();
    if (this.disposed || this.speechActive) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.disposed && !this.speechActive) this.onSilence();
    }, this.silenceMs);
  }

  private clearTimer() {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
