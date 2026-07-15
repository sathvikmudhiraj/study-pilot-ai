import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordingSilenceTimer } from "../recordingSilenceTimer";

const SILENCE_MS = 12_000;

describe("RecordingSilenceTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps recording during 5 seconds of speech and stops only after silence", () => {
    const onSilence = vi.fn();
    const timer = new RecordingSilenceTimer({ silenceMs: SILENCE_MS, onSilence });

    timer.start();
    timer.speechStart();
    vi.advanceTimersByTime(5_000);
    expect(onSilence).not.toHaveBeenCalled();

    timer.speechEnd();
    vi.advanceTimersByTime(SILENCE_MS - 1);
    expect(onSilence).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("keeps recording during 30 seconds of continuous speech activity", () => {
    const onSilence = vi.fn();
    const timer = new RecordingSilenceTimer({ silenceMs: SILENCE_MS, onSilence });

    timer.start();
    for (let second = 0; second < 30; second += 1) {
      timer.speechActivity();
      vi.advanceTimersByTime(1_000);
    }

    expect(onSilence).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SILENCE_MS);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("never stops during 60+ seconds while speech is active", () => {
    const onSilence = vi.fn();
    const timer = new RecordingSilenceTimer({ silenceMs: SILENCE_MS, onSilence });

    timer.start();
    timer.speechStart();
    vi.advanceTimersByTime(65_000);

    expect(onSilence).not.toHaveBeenCalled();
    timer.speechEnd();
    vi.advanceTimersByTime(SILENCE_MS);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });

  it("handles pause and resume without duplicate timers", () => {
    const onSilence = vi.fn();
    const timer = new RecordingSilenceTimer({ silenceMs: SILENCE_MS, onSilence });

    timer.start();
    timer.speechStart();
    vi.advanceTimersByTime(2_000);
    timer.speechEnd();
    vi.advanceTimersByTime(6_000);

    timer.speechStart();
    vi.advanceTimersByTime(20_000);
    expect(onSilence).not.toHaveBeenCalled();

    timer.speechActivity();
    timer.speechActivity();
    timer.speechEnd();
    vi.advanceTimersByTime(SILENCE_MS);
    expect(onSilence).toHaveBeenCalledTimes(1);
  });
});
