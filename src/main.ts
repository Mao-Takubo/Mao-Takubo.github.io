import "./styles/main.css";
import { applyPaletteToCss, applyThemeToCss, defaultPalette, palettes, rainbowCss, rainbowHue, type Palette } from "./config/theme";
import { createStore, initialState } from "./app/state";
import { createController } from "./app/commands";
import { createAudioLevel } from "./core/audioReactive";
import { createCore, type CoreFocus } from "./core/createCore";
import { createVoice } from "./services/voice";
import { createRecognizer } from "./services/recognition";
import { createNavigation } from "./ui/navigation";
import { createPanels } from "./ui/panels";
import { createPalettePicker } from "./ui/palette";
import { required } from "./ui/dom";

/** Keep in sync with the stacked-layout @media query in main.css. */
const STACKED = "(max-width: 820px), (max-aspect-ratio: 1/1)";
const MUTE_KEY = "mao-core:muted";
const PALETTE_KEY = "mao-core:palette";

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
function saveMuted(m: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

function readPalette(): Palette {
  try {
    return palettes.find((p) => p.id === localStorage.getItem(PALETTE_KEY)) ?? defaultPalette;
  } catch {
    return defaultPalette;
  }
}

applyThemeToCss();

const html = document.documentElement;
const app = required<HTMLElement>("#app");
const canvas = required<HTMLCanvasElement>("#core-canvas");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const stacked = matchMedia(STACKED);

const audio = new Audio();
audio.preload = "auto";
const level = createAudioLevel(audio);
const voice = createVoice(audio, level);
const recognizer = createRecognizer();

const store = createStore(initialState(recognizer.supported, readMuted()));
const controller = createController(store, voice, recognizer);
const nav = createNavigation(store, controller);
createPanels(store, controller, nav.speakButton);

const core = createCore(canvas, {
  getLevel: (dt) => level.read(dt),
  reduceMotion: reduceMotion.matches,
  onContextLost: () => html.classList.add("no-webgl"),
  onContextRestored: () => html.classList.remove("no-webgl"),
});
if (!core) html.classList.add("no-webgl");

function focusFor(): CoreFocus {
  if (!store.get().activePanel) return "center";
  return stacked.matches ? "top" : "side";
}
function syncCore() {
  const f = focusFor();
  app.dataset.focus = f; // also drives the CSS fallback core
  core?.setFocus(f);
}
store.subscribe((s, prev) => {
  core?.setVoiceState(s.voiceState);
  if (s.muted !== prev.muted) saveMuted(s.muted);
  syncCore();
});
stacked.addEventListener("change", syncCore);
syncCore();

// --- core colour: chosen palette, remembered; rainbow also recolours the HUD ---
let rainbowTimer = 0;
function setPalette(p: Palette) {
  window.clearInterval(rainbowTimer);
  core?.setPalette(p);
  if (p.rainbow) {
    const tick = () => applyPaletteToCss(rainbowCss(rainbowHue(performance.now() / 1000, reduceMotion.matches)));
    tick();
    if (!reduceMotion.matches) rainbowTimer = window.setInterval(() => !document.hidden && tick(), 100);
  } else {
    applyPaletteToCss(p);
  }
  try {
    localStorage.setItem(PALETTE_KEY, p.id);
  } catch {
    /* storage unavailable */
  }
}
const initialPalette = readPalette();
createPalettePicker(initialPalette, setPalette);
setPalette(initialPalette);

void voice.load();

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") controller.escape();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) controller.onHidden();
});
addEventListener("pagehide", (e) => {
  if (!e.persisted) core?.dispose();
});

if (!recognizer.supported) {
  store.set({ notice: "音声入力はこの環境では利用できません。項目を選んでください" });
}
