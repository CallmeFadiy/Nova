import { isTauri } from "./tauri";

export interface EqSettings {
  enabled: boolean;
  bands: number[];
  preamp: number;
}

export const EQ_FREQUENCIES = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];

export const EQ_LABELS = [
  "31",
  "62",
  "125",
  "250",
  "500",
  "1k",
  "2k",
  "4k",
  "8k",
  "16k",
];

class AudioEngine {
  private audio: HTMLAudioElement;
  private context: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private preampNode: GainNode | null = null;
  private filters: BiquadFilterNode[] = [];
  private sourceCreated = false;
  private eq: EqSettings = {
    enabled: true,
    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    preamp: 0,
  };
  private demoTimer: number | null = null;
  private demoPosition = 0;
  private demoDuration = 0;

  onTime: ((positionMs: number, durationMs: number) => void) | null = null;
  onEnded: (() => void) | null = null;
  onPlayState: ((playing: boolean) => void) | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = "metadata";
    this.audio.crossOrigin = "anonymous";
    this.audio.volume = 0.78;
    this.audio.addEventListener("timeupdate", () => {
      this.onTime?.(
        this.audio.currentTime * 1000,
        (this.audio.duration || 0) * 1000,
      );
    });
    this.audio.addEventListener("loadedmetadata", () => {
      this.onTime?.(
        this.audio.currentTime * 1000,
        (this.audio.duration || 0) * 1000,
      );
    });
    this.audio.addEventListener("ended", () => {
      this.onEnded?.();
    });
    this.audio.addEventListener("play", () => {
      this.onPlayState?.(true);
    });
    this.audio.addEventListener("pause", () => {
      this.onPlayState?.(false);
    });
  }

  async load(
    src: string,
    autoplay: boolean,
    startMs = 0,
    durationMs = 0,
  ): Promise<void> {
    this.stopDemo();
    if (!isTauri || !src) {
      this.demoPosition = startMs;
      this.demoDuration = durationMs;
      this.onTime?.(this.demoPosition, this.demoDuration);
      if (autoplay) await this.play();
      return;
    }

    this.audio.src = src;
    this.audio.load();

    if (startMs > 0) {
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          this.audio.removeEventListener("loadedmetadata", finish);
          resolve();
        };
        this.audio.addEventListener("loadedmetadata", finish);
        window.setTimeout(finish, 1200);
      });
      try {
        this.audio.currentTime = startMs / 1000;
      } catch {
        // ignore seek errors before metadata
      }
    }

    if (autoplay) await this.play();
  }

  async play(): Promise<void> {
    if (!isTauri || !this.audio.src) {
      if (this.demoTimer === null) {
        this.demoTimer = window.setInterval(() => {
          this.demoPosition += 1000;
          if (this.demoPosition >= this.demoDuration) {
            this.demoPosition = this.demoDuration;
            this.onTime?.(this.demoPosition, this.demoDuration);
            this.stopDemo();
            this.onPlayState?.(false);
            this.onEnded?.();
            return;
          }
          this.onTime?.(this.demoPosition, this.demoDuration);
        }, 1000);
        this.onPlayState?.(true);
      }
      return;
    }

    this.ensureGraph();
    try {
      await this.context?.resume();
    } catch {
      // ignore resume errors
    }
    await this.audio.play();
  }

  pause(): void {
    if (!isTauri || !this.audio.src) {
      this.stopDemo();
      this.onPlayState?.(false);
      return;
    }
    this.audio.pause();
  }

  unload(): void {
    this.stopDemo();
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.demoPosition = 0;
    this.demoDuration = 0;
    this.onPlayState?.(false);
  }

  seek(ms: number): void {
    if (!isTauri || !this.audio.src) {
      this.demoPosition = Math.max(0, Math.min(ms, this.demoDuration));
      this.onTime?.(this.demoPosition, this.demoDuration);
      return;
    }
    try {
      this.audio.currentTime = ms / 1000;
    } catch {
      // ignore
    }
  }

  setVolume(value: number): void {
    this.audio.volume = Math.max(0, Math.min(1, value));
  }

  setMuted(muted: boolean): void {
    this.audio.muted = muted;
  }

  setEq(eq: EqSettings): void {
    this.eq = {
      enabled: eq.enabled,
      bands: [...eq.bands],
      preamp: eq.preamp,
    };
    if (this.preampNode) {
      this.preampNode.gain.value = eq.enabled
        ? Math.pow(10, eq.preamp / 20)
        : 1;
    }
    this.filters.forEach((filter, index) => {
      filter.gain.value = eq.enabled ? eq.bands[index] ?? 0 : 0;
    });
  }

  get currentTimeMs(): number {
    if (!isTauri || !this.audio.src) return this.demoPosition;
    return this.audio.currentTime * 1000;
  }

  private ensureGraph(): void {
    if (this.sourceCreated) return;
    this.sourceCreated = true;
    try {
      const context = new AudioContext();
      this.context = context;
      this.source = context.createMediaElementSource(this.audio);
      this.preampNode = context.createGain();
      this.preampNode.gain.value = this.eq.enabled
        ? Math.pow(10, this.eq.preamp / 20)
        : 1;
      this.filters = EQ_FREQUENCIES.map((frequency) => {
        const filter = context.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = frequency;
        filter.Q.value = 1.1;
        filter.gain.value = 0;
        return filter;
      });
      let node: AudioNode = this.source;
      node.connect(this.preampNode);
      node = this.preampNode;
      for (const filter of this.filters) {
        node.connect(filter);
        node = filter;
      }
      node.connect(context.destination);
      this.setEq(this.eq);
    } catch {
      this.context = null;
      this.source = null;
      this.preampNode = null;
      this.filters = [];
    }
  }

  private stopDemo(): void {
    if (this.demoTimer !== null) {
      window.clearInterval(this.demoTimer);
      this.demoTimer = null;
    }
  }
}

export const audioEngine = new AudioEngine();

if (import.meta.env.DEV && typeof window !== "undefined") {
  (
    window as unknown as { __novaAudio: AudioEngine }
  ).__novaAudio = audioEngine;
}
