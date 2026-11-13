import { describe, expect, it, vi } from "vitest";
import { createController } from "./commands";
import { createStore, initialState } from "./state";
import type { RecognitionHandlers, Recognizer } from "../services/recognition";
import type { VoicePlayer } from "../services/voice";

function setup() {
  const store = createStore(initialState(true, false));
  const spoken: string[] = [];
  const voice: VoicePlayer = {
    load: async () => {},
    unlock: () => {},
    setMuted: () => {},
    stop: vi.fn(),
    speak: async (key, h) => {
      spoken.push(key);
      h.onStart(key);
      h.onMode("text");
    },
  };
  let handlers: RecognitionHandlers | null = null;
  const recognizer: Recognizer = {
    supported: true,
    cancel: vi.fn(),
    start: (h) => {
      handlers = h;
      return true;
    },
  };
  return { store, spoken, voice, recognizer, ctl: createController(store, voice, recognizer), h: () => handlers! };
}

describe("controller", () => {
  it("opens the panel from a recognised utterance and keeps it open", () => {
    const t = setup();
    t.ctl.toggleListening();
    expect(t.store.get().voiceState).toBe("listening");
    t.h().onFinal("ステータスを見せて");
    expect(t.store.get().activePanel).toBe("status");
    expect(t.store.get().voiceState).toBe("idle");
    expect(t.spoken).toEqual(["status"]);
  });
  it("does not open anything for unknown or ambiguous speech", () => {
    const t = setup();
    t.ctl.toggleListening();
    t.h().onFinal("ステータスと研究");
    expect(t.store.get().activePanel).toBeNull();
    expect(t.store.get().candidates).toEqual(["status", "research"]);
    t.ctl.toggleListening();
    t.h().onFinal("あいうえお");
    expect(t.store.get().activePanel).toBeNull();
    expect(t.spoken).toEqual(["ambiguous", "unknown"]);
  });
  it("shows an error and returns to idle when recognition fails", () => {
    const t = setup();
    t.ctl.toggleListening();
    t.h().onError("denied");
    expect(t.store.get().voiceState).toBe("idle");
    expect(t.store.get().notice).toContain("マイク");
  });
  it("a second SPEAK press cancels listening", () => {
    const t = setup();
    t.ctl.toggleListening();
    t.ctl.toggleListening();
    expect(t.store.get().voiceState).toBe("idle");
    expect(t.recognizer.cancel).toHaveBeenCalled();
  });
  it("back closes the panel; escape closes and stops everything", () => {
    const t = setup();
    t.ctl.dispatchCommand("research", "click");
    t.ctl.dispatchCommand("back", "click");
    expect(t.store.get().activePanel).toBeNull();
    t.ctl.dispatchCommand("help", "click");
    t.ctl.escape();
    expect(t.store.get().activePanel).toBeNull();
  });
});
