import type { AudioLevel } from "../core/audioReactive";

export interface ManifestEntry {
  text: string;
  path: string | null;
}
export type Manifest = Record<string, ManifestEntry>;
export type SpeakMode = "recording" | "tts" | "text";

export interface SpeakHandlers {
  onStart(text: string): void;
  onMode(mode: SpeakMode): void;
  onEnd(): void;
  onBlocked(): void;
}

export interface VoicePlayer {
  load(): Promise<void>;
  unlock(): void;
  speak(key: string, h: SpeakHandlers): Promise<void>;
  stop(): void;
  setMuted(m: boolean): void;
}

export function parseManifest(json: unknown): Manifest {
  if (typeof json !== "object" || json === null) throw new Error("manifest must be an object");
  const out: Manifest = {};
  for (const [key, v] of Object.entries(json)) {
    const e = v as Partial<ManifestEntry> | null;
    if (!e || typeof e.text !== "string" || !(e.path === null || typeof e.path === "string")) {
      throw new Error(`invalid manifest entry: ${key}`);
    }
    out[key] = { text: e.text, path: e.path };
  }
  return out;
}

const assetUrl = (path: string) => new URL(import.meta.env.BASE_URL + path, window.location.origin).href;

export function createVoice(audio: HTMLAudioElement, level: AudioLevel): VoicePlayer {
  let manifest: Manifest = {};
  let token = 0;
  let muted = false;
  let abortOutput: (() => void) | null = null;
  let loading: Promise<void> = Promise.resolve();

  async function loadManifest() {
    try {
      const res = await fetch(assetUrl("audio/manifest.json"));
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      manifest = parseManifest(await res.json());
    } catch (e) {
      console.warn("voice manifest unavailable; subtitles only", e);
    }
  }

  function stop() {
    token++;
    abortOutput?.();
    abortOutput = null;
    audio.pause();
    level.setPseudo(false);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  type Outcome = "done" | "failed" | "blocked" | "stale";

  function playRecording(url: string, my: number, h: SpeakHandlers): Promise<Outcome> {
    return new Promise((resolve) => {
      const finish = (o: Outcome) => {
        audio.onended = audio.onerror = null;
        abortOutput = null;
        resolve(o);
      };
      abortOutput = () => finish("stale");
      audio.onended = () => finish("done");
      audio.onerror = () => finish("failed");
      audio.src = url;
      audio.currentTime = 0;
      audio.play().then(
        () => {
          if (my === token) h.onMode("recording");
        },
        (e: unknown) => finish((e as DOMException)?.name === "NotAllowedError" ? "blocked" : "failed"),
      );
    });
  }

  function speakSynth(text: string, my: number, h: SpeakHandlers): Promise<Outcome> {
    const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
    if (!synth || !text) return Promise.resolve("failed");
    const voices = synth.getVoices();
    if (voices.length > 0 && !voices.some((v) => v.lang.toLowerCase().startsWith("ja"))) {
      return Promise.resolve("failed");
    }
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP";
      const voice = voices.find((v) => v.lang.toLowerCase().startsWith("ja"));
      if (voice) u.voice = voice;
      // Some browsers never fire `end`; don't leave the UI stuck in "speaking".
      const timer = window.setTimeout(() => finish("done"), text.length * 400 + 3000);
      const finish = (o: Outcome) => {
        window.clearTimeout(timer);
        u.onstart = u.onend = u.onerror = null;
        abortOutput = null;
        resolve(o);
      };
      abortOutput = () => finish("stale");
      u.onstart = () => {
        if (my === token) {
          level.setPseudo(true);
          h.onMode("tts");
        }
      };
      u.onend = () => finish("done");
      u.onerror = () => finish("failed");
      synth.speak(u);
    });
  }

  return {
    load() {
      loading = loadManifest();
      return loading;
    },
    unlock() {
      level.unlock();
    },
    setMuted(m) {
      muted = m;
      if (m) stop();
    },
    stop,
    async speak(key, h) {
      stop();
      const my = token;
      await loading; // the manifest may still be in flight when the first click arrives
      if (my !== token) return;
      const entry = manifest[key];
      const text = entry?.text ?? "";
      h.onStart(text);
      if (muted || !text) {
        h.onMode("text");
        return;
      }
      let outcome: Outcome = "failed";
      if (entry?.path) {
        outcome = await playRecording(assetUrl(entry.path), my, h);
        if (my !== token) return;
        if (outcome === "blocked") {
          h.onMode("text");
          h.onBlocked();
          return;
        }
      }
      if (outcome === "failed") {
        outcome = await speakSynth(text, my, h);
        if (my !== token) return;
        if (outcome === "failed") {
          h.onMode("text");
          return;
        }
      }
      level.setPseudo(false);
      h.onEnd();
    },
  };
}
