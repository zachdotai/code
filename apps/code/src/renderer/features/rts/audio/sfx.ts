import disappearUrl from "@renderer/assets/sounds/disappear.wav";
import { logger } from "@utils/logger";

const log = logger.scope("hedgemony-sfx");

export type SfxName =
  | "select"
  | "order"
  | "deselect"
  | "place"
  | "arrive"
  | "spawn"
  | "error"
  | "goalComplete"
  | "retire";

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private volume = 0.5;

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyMasterGain();
  }

  play(name: SfxName): void {
    const ac = this.ensureContext();
    if (!ac) return;
    const { ctx, master } = ac;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    switch (name) {
      case "select":
        this.playSelect(ctx, master);
        return;
      case "order":
        this.playOrder(ctx, master);
        return;
      case "deselect":
        this.playDeselect(ctx, master);
        return;
      case "place":
        this.playPlace(ctx, master);
        return;
      case "arrive":
        this.playArrive(ctx, master);
        return;
      case "spawn":
        this.playSpawn(ctx, master);
        return;
      case "error":
        this.playError(ctx, master);
        return;
      case "goalComplete":
        this.playGoalComplete(ctx, master);
        return;
      case "retire":
        this.playFile(ctx, master, disappearUrl);
        return;
    }
  }

  private effectiveGain(): number {
    return this.muted ? 0 : this.volume;
  }

  private applyMasterGain(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(
      this.effectiveGain(),
      this.ctx.currentTime,
      0.02,
    );
  }

  private ensureContext(): { ctx: AudioContext; master: GainNode } | null {
    if (this.ctx && this.master) return { ctx: this.ctx, master: this.master };
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = this.effectiveGain();
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      return { ctx, master };
    } catch (error) {
      log.warn("Failed to create AudioContext", { error });
      return null;
    }
  }

  // --- Recipes -----------------------------------------------------------
  // Each recipe schedules a self-contained sound graph and lets the nodes
  // garbage-collect once they stop. Keep total duration <300ms unless the
  // event is rare (goalComplete).

  private playSelect(ctx: AudioContext, dest: AudioNode): void {
    // Crisp upward blip — "yes?"
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.06);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);

    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  private playOrder(ctx: AudioContext, dest: AudioNode): void {
    // Confident downward sweep + click — "moving out"
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.12);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 1;
    filter.frequency.setValueAtTime(2000, t);
    filter.frequency.exponentialRampToValueAtTime(500, t + 0.12);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

    osc.connect(filter).connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + 0.14);

    this.click(ctx, dest, 0.15);
  }

  private playDeselect(ctx: AudioContext, dest: AudioNode): void {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  private playPlace(ctx: AudioContext, dest: AudioNode): void {
    // Heavy thunk — sub body + filtered noise impact + small high tinkle
    const t = ctx.currentTime;

    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(80, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.5, t);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    sub.connect(subGain).connect(dest);
    sub.start(t);
    sub.stop(t + 0.3);

    const noise = ctx.createBufferSource();
    noise.buffer = whiteNoise(ctx, 0.1);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 800;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    noise.connect(noiseFilter).connect(noiseGain).connect(dest);
    noise.start(t);

    const tink = ctx.createOscillator();
    tink.type = "triangle";
    tink.frequency.value = 2000;
    const tinkGain = ctx.createGain();
    tinkGain.gain.setValueAtTime(0.08, t + 0.02);
    tinkGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    tink.connect(tinkGain).connect(dest);
    tink.start(t + 0.02);
    tink.stop(t + 0.13);
  }

  private playArrive(ctx: AudioContext, dest: AudioNode): void {
    // Soft "in position" — kept very quiet because it fires often
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 440;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  private playSpawn(ctx: AudioContext, dest: AudioNode): void {
    // Bubbly ascending arpeggio — new hoglet
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const start = t + i * 0.04;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.08);

      osc.connect(gain).connect(dest);
      osc.start(start);
      osc.stop(start + 0.09);
    });
  }

  private playError(ctx: AudioContext, dest: AudioNode): void {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.12);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  private playGoalComplete(ctx: AudioContext, dest: AudioNode): void {
    // Triumphant fanfare — rare event so allowed to be longer + louder
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      const start = t + i * 0.08;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);

      osc.connect(gain).connect(dest);
      osc.start(start);
      osc.stop(start + 0.32);
    });
  }

  private playFile(ctx: AudioContext, dest: AudioNode, url: string): void {
    fetch(url)
      .then((res) => res.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.connect(dest);
        src.start();
      })
      .catch((err) => log.warn("Failed to play sfx file", { err }));
  }

  private click(ctx: AudioContext, dest: AudioNode, gainVal: number): void {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = decayingNoise(ctx, 0.01);

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 2000;

    const gain = ctx.createGain();
    gain.gain.value = gainVal;

    src.connect(filter).connect(gain).connect(dest);
    src.start(t);
  }
}

function whiteNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
  const buffer = ctx.createBuffer(
    1,
    ctx.sampleRate * durationSec,
    ctx.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function decayingNoise(ctx: AudioContext, durationSec: number): AudioBuffer {
  const buffer = ctx.createBuffer(
    1,
    ctx.sampleRate * durationSec,
    ctx.sampleRate,
  );
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  return buffer;
}

let _engine: SfxEngine | null = null;
function engine(): SfxEngine {
  if (!_engine) _engine = new SfxEngine();
  return _engine;
}

export function playSfx(name: SfxName): void {
  engine().play(name);
}

export function setSfxMuted(muted: boolean): void {
  engine().setMuted(muted);
}

export function setSfxVolume(volume: number): void {
  engine().setVolume(volume);
}
