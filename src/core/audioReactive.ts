/**
 * Turns an <audio> element's output into a smoothed 0..1 level.
 * The MediaElementAudioSourceNode may only be created once per element,
 * so everything lives in one object that is reused for every clip.
 */
export interface AudioLevel {
  /** call from a user gesture */
  unlock(): void;
  /** smoothed level; call once per frame */
  read(dt: number): number;
  /** gentle fake pulse for speech synthesis (its audio cannot be analysed) */
  setPseudo(on: boolean): void;
}

export function createAudioLevel(audio: HTMLAudioElement): AudioLevel {
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let buffer: Float32Array<ArrayBuffer> | null = null;
  let level = 0;
  let pseudo = false;
  let t = 0;

  function ensure() {
    if (ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      ctx = new Ctor();
      const source = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      buffer = new Float32Array(analyser.fftSize);
      source.connect(analyser);
      analyser.connect(ctx.destination);
    } catch {
      // Without analysis the audio element still plays normally.
      ctx = analyser = null;
    }
  }

  return {
    unlock() {
      ensure();
      void ctx?.resume().catch(() => {});
    },
    setPseudo(on) {
      pseudo = on;
    },
    read(dt) {
      t += dt;
      let target = 0;
      if (analyser && buffer && !audio.paused && !audio.ended) {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i]! * buffer[i]!;
        target = Math.min(1, Math.sqrt(sum / buffer.length) * 4);
      } else if (pseudo) {
        target = 0.3 + 0.18 * Math.sin(t * 9) * Math.sin(t * 3.1);
      }
      // fast attack, slower release
      const k = 1 - Math.exp(-dt * (target > level ? 18 : 6));
      level += (target - level) * k;
      return level;
    },
  };
}
