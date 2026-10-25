import type { NotificationSound } from "../types";

export const NOTIFICATION_SOUND_OPTIONS: Array<{
  id: NotificationSound;
  name: string;
  description: string;
}> = [
  {
    id: "soft",
    name: "Nova Soft",
    description: "Тёплый аккорд C–E–G. Мягкий, не отвлекает.",
  },
  {
    id: "glass",
    name: "Nova Glass",
    description: "Короткий стеклянный колокольчик. Чистый и светлый.",
  },
  {
    id: "low",
    name: "Nova Low",
    description: "Низкий двухнотный сигнал. Спокойный, для тёмной темы.",
  },
  {
    id: "pop",
    name: "Nova Pop",
    description: "Быстрый упругий щелчок. Заметный, но короткий.",
  },
  {
    id: "off",
    name: "Без звука",
    description: "Уведомления только визуальные.",
  },
];

let audioContext: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

function note(
  ctx: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  volume: number,
  type: OscillatorType,
) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + start);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, volume),
    ctx.currentTime + start + 0.012,
  );
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    ctx.currentTime + start + duration,
  );
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(ctx.currentTime + start);
  oscillator.stop(ctx.currentTime + start + duration + 0.03);
}

export function playNotificationSound(
  sound: NotificationSound,
  volume = 0.6,
): void {
  if (sound === "off" || volume <= 0) return;
  const ctx = context();
  if (!ctx) return;
  const master = Math.max(0, Math.min(1, volume));

  if (sound === "soft") {
    note(ctx, 523.25, 0, 0.42, 0.12 * master, "sine");
    note(ctx, 659.25, 0.07, 0.42, 0.1 * master, "sine");
    note(ctx, 783.99, 0.14, 0.55, 0.08 * master, "sine");
    return;
  }
  if (sound === "glass") {
    note(ctx, 1046.5, 0, 0.28, 0.1 * master, "triangle");
    note(ctx, 1567.98, 0.04, 0.4, 0.05 * master, "sine");
    return;
  }
  if (sound === "low") {
    note(ctx, 174.61, 0, 0.38, 0.16 * master, "sine");
    note(ctx, 261.63, 0.12, 0.55, 0.11 * master, "sine");
    return;
  }
  note(ctx, 440, 0, 0.13, 0.13 * master, "triangle");
  note(ctx, 880, 0.035, 0.24, 0.08 * master, "sine");
}
