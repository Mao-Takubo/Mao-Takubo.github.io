import type { PanelId } from "../config/menus";

export type VoiceState = "idle" | "speaking" | "listening";

export interface AppState {
  booted: boolean;
  voiceState: VoiceState;
  activePanel: PanelId | null;
  muted: boolean;
  recognitionSupported: boolean;
  transcript: string;
  notice: string | null;
  subtitle: string;
  candidates: string[];
  /** voice key whose playback the browser blocked; shows a replay button */
  blockedKey: string | null;
}

export type Listener = (state: AppState, prev: AppState) => void;

export function createStore(initial: AppState) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<AppState>) {
      const prev = state;
      state = { ...state, ...patch };
      listeners.forEach((l) => l(state, prev));
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type Store = ReturnType<typeof createStore>;

export const initialState = (recognitionSupported: boolean, muted: boolean): AppState => ({
  booted: false,
  voiceState: "idle",
  activePanel: null,
  muted,
  recognitionSupported,
  transcript: "",
  notice: null,
  subtitle: "",
  candidates: [],
  blockedKey: null,
});
