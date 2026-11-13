import { menuById, menus, type CommandId } from "../config/menus";
import type { Store } from "./state";
import { matchCommand } from "./matcher";
import type { VoicePlayer, SpeakHandlers } from "../services/voice";
import type { RecognitionError, Recognizer } from "../services/recognition";

export type Source = "voice" | "click" | "keyboard";

const ERROR_MESSAGES: Record<RecognitionError, string> = {
  unsupported: "音声入力はこの環境では利用できません。項目を選んでください",
  denied: "マイクを利用できません。クリックで操作できます",
  "no-mic": "マイクが見つからないか、利用できません",
  "no-speech": "声を確認できませんでした。もう一度SPEAKを押してください",
  network: "音声認識に接続できません。クリックで操作できます",
  other: "音声を認識できませんでした。もう一度お試しください",
};

export const PRIVACY_NOTICE = "音声認識はブラウザのサービスへ送信される場合があります。クリックでも操作できます";

export function createController(store: Store, voice: VoicePlayer, recognizer: Recognizer) {
  // Handlers are tied to the speak call that created them, so a late callback
  // from an interrupted clip cannot change state for a newer one.
  let speakSeq = 0;
  let privacyShown = false;

  function say(key: string) {
    const my = ++speakSeq;
    const current = () => my === speakSeq;
    const h: SpeakHandlers = {
      onStart: (text) => current() && store.set({ subtitle: text, blockedKey: null }),
      onMode: (mode) => {
        if (current()) store.set({ voiceState: mode === "text" ? "idle" : "speaking" });
      },
      onEnd: () => current() && store.get().voiceState === "speaking" && store.set({ voiceState: "idle" }),
      onBlocked: () => current() && store.set({ blockedKey: key, voiceState: "idle" }),
    };
    void voice.speak(key, h);
  }

  function stopOutput() {
    speakSeq++;
    voice.stop();
    if (store.get().voiceState === "speaking") store.set({ voiceState: "idle" });
  }

  function cancelListening() {
    recognizer.cancel();
    if (store.get().voiceState === "listening") store.set({ voiceState: "idle" });
  }

  function cancelAll() {
    cancelListening();
    stopOutput();
  }

  function dispatchCommand(id: CommandId, _source: Source) {
    cancelListening();
    store.set({ activePanel: id === "back" ? null : id, transcript: "", notice: null, candidates: [], blockedKey: null });
    say(menuById(id).voiceKey);
  }

  function handleUtterance(text: string) {
    store.set({ voiceState: "idle", transcript: text });
    const r = matchCommand(text);
    if (r.type === "match") return dispatchCommand(r.id, "voice");
    if (r.type === "ambiguous") {
      store.set({ candidates: r.candidates, notice: `「${text}」には複数の項目が含まれています。選んでください` });
      return say("ambiguous");
    }
    store.set({ candidates: [], notice: `「${text}」と認識しました。もう一度話すか、項目を選んでください` });
    say("unknown");
  }

  function toggleListening() {
    const s = store.get();
    if (!recognizer.supported) return store.set({ notice: ERROR_MESSAGES.unsupported });
    if (s.voiceState === "listening") return cancelListening();
    stopOutput();
    store.set({ voiceState: "listening", transcript: "", candidates: [], notice: privacyShown ? null : PRIVACY_NOTICE });
    privacyShown = true;
    const started = recognizer.start({
      onInterim: (t) => store.set({ transcript: t }),
      onFinal: handleUtterance,
      onError: (code) => store.set({ voiceState: "idle", notice: ERROR_MESSAGES[code] }),
    });
    if (!started) store.set({ voiceState: "idle", notice: ERROR_MESSAGES.other });
  }

  return {
    boot(silent: boolean) {
      if (store.get().booted) return;
      voice.unlock();
      const muted = silent || store.get().muted;
      voice.setMuted(muted);
      store.set({ booted: true, muted });
      say("welcome");
    },
    dispatchCommand,
    toggleListening,
    cancelAll,
    escape() {
      cancelAll();
      if (store.get().activePanel) store.set({ activePanel: null });
    },
    setMuted(m: boolean) {
      voice.setMuted(m);
      if (m) stopOutput();
      store.set({ muted: m });
    },
    replayBlocked() {
      const key = store.get().blockedKey;
      if (key) {
        voice.unlock();
        say(key);
      }
    },
    /** tab hidden: stop everything, never resume on its own */
    onHidden: cancelAll,
    commandIds: menus.map((m) => m.id),
  };
}

export type Controller = ReturnType<typeof createController>;
