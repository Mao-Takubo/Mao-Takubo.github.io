export type RecognitionError =
  | "unsupported"
  | "denied"
  | "no-mic"
  | "no-speech"
  | "network"
  | "other";

export interface RecognitionHandlers {
  onInterim(text: string): void;
  /** exactly one of onFinal / onError fires per started session (unless cancelled) */
  onFinal(text: string): void;
  onError(code: RecognitionError): void;
}

export interface Recognizer {
  readonly supported: boolean;
  start(h: RecognitionHandlers): boolean;
  /** silently abort the current session; no handler is called */
  cancel(): void;
}

interface SRResult {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}
interface SREvent {
  results: ArrayLike<SRResult>;
}
interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}
type SRConstructor = new () => SRInstance;

const TIMEOUT_MS = 10_000;

export function createRecognizer(): Recognizer {
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  let session = 0;
  let abortCurrent: (() => void) | null = null;

  return {
    supported: !!Ctor,
    cancel() {
      session++;
      abortCurrent?.();
      abortCurrent = null;
    },
    start(h) {
      if (!Ctor) return false;
      this.cancel();
      const my = session;
      const rec = new Ctor();
      rec.lang = "ja-JP";
      rec.continuous = false;
      rec.interimResults = true;
      let settled = false;
      let lastText = "";

      const timer = window.setTimeout(() => settle(() => h.onError("no-speech")), TIMEOUT_MS);
      const settle = (fn: () => void) => {
        if (settled || my !== session) return;
        settled = true;
        window.clearTimeout(timer);
        abortCurrent = null;
        rec.onresult = rec.onerror = rec.onend = null;
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
        fn();
      };
      abortCurrent = () => {
        settled = true;
        window.clearTimeout(timer);
        rec.onresult = rec.onerror = rec.onend = null;
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
      };

      rec.onresult = (e) => {
        if (my !== session) return;
        let text = "";
        let final = false;
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i]!;
          text += r[0].transcript;
          if (r.isFinal) final = true;
        }
        if (text.trim()) lastText = text.trim();
        if (final) settle(() => h.onFinal(text.trim()));
        else h.onInterim(text);
      };
      rec.onerror = (e) => {
        const code: RecognitionError | null =
          e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied"
          : e.error === "audio-capture" ? "no-mic"
          : e.error === "no-speech" ? "no-speech"
          : e.error === "network" ? "network"
          : e.error === "aborted" ? null
          : "other";
        if (code) settle(() => h.onError(code));
      };
      // Some engines end without a final flag; use what was heard.
      rec.onend = () => settle(() => (lastText ? h.onFinal(lastText) : h.onError("no-speech")));

      try {
        rec.start();
      } catch {
        settle(() => h.onError("other"));
        return false;
      }
      return true;
    },
  };
}
