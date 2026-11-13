import "./styles/main.css";
import { applyPaletteToCss, applyThemeToCss, defaultPalette, palettes, rainbowCss, rainbowHue } from "./config/theme";
import { createStore, initialState } from "./app/state";
import { createController } from "./app/commands";
import { createAudioLevel } from "./core/audioReactive";
import { createCore, type CoreFocus } from "./core/createCore";
import { createVoice } from "./services/voice";
import { createRecognizer } from "./services/recognition";
import { createNavigation } from "./ui/navigation";
import { createPanels } from "./ui/panels";
import { required } from "./ui/dom";

/** Keep in sync with the stacked-layout @media query in main.css. */
const STACKED = "(max-width: 820px), (max-aspect-ratio: 1/1)";
const MUTE_KEY = "mao-core:muted";
const PALETTE_KEY = "mao-core:palette";
const N = palettes.length;

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

function readIndex(): number {
  try {
    const i = palettes.findIndex((p) => p.id === localStorage.getItem(PALETTE_KEY));
    return i >= 0 ? i : palettes.indexOf(defaultPalette);
  } catch {
    return palettes.indexOf(defaultPalette);
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
const stackedFocus = () => (stacked.matches ? "top" : "side");
createPanels(
  store,
  controller,
  nav.speakButton,
  () => {
    if (core) return core.screenPosition(stackedFocus());
    const r = required<HTMLElement>(".core-fallback").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  },
  () => core?.pulse(),
);

let paletteIndex = readIndex();
const ringLabel = required<HTMLElement>("#ring-label");
const live = required<HTMLElement>("#sr-live");
let rainbowTimer = 0;

/** HUD / panel colours, label and saved choice follow the core in front. */
function applyIndex(index: number, announce = true) {
  paletteIndex = index;
  const p = palettes[index]!;
  window.clearInterval(rainbowTimer);
  if (p.rainbow) {
    const tick = () => applyPaletteToCss(rainbowCss(rainbowHue(performance.now() / 1000, reduceMotion.matches)));
    tick();
    if (!reduceMotion.matches) rainbowTimer = window.setInterval(() => !document.hidden && tick(), 100);
  } else {
    applyPaletteToCss(p);
  }
  ringLabel.replaceChildren(`${index + 1} / ${N}  `, Object.assign(document.createElement("b"), { textContent: p.label }));
  if (announce) live.textContent = `コアの色: ${p.label}`;
  try {
    localStorage.setItem(PALETTE_KEY, p.id);
  } catch {
    /* storage unavailable */
  }
}

const core = createCore(canvas, {
  palettes,
  initialIndex: paletteIndex,
  onSelect: (i) => applyIndex(i),
  onTap: () => controller.boot(false),
  getLevel: (dt) => level.read(dt),
  reduceMotion: reduceMotion.matches,
  onContextLost: () => html.classList.add("no-webgl"),
  onContextRestored: () => html.classList.remove("no-webgl"),
});
applyIndex(paletteIndex, false);
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

// --- ring controls: buttons and arrow keys (drag/swipe/wheel live in the core) ---
function stepRing(delta: number) {
  if (core) core.step(delta);
  else applyIndex(((paletteIndex + delta) % N + N) % N); // no WebGL: colours only
}
required<HTMLButtonElement>("#ring-prev").addEventListener("click", () => stepRing(-1));
required<HTMLButtonElement>("#ring-next").addEventListener("click", () => stepRing(1));

void voice.load();

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") controller.escape();
  else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.altKey && !e.ctrlKey && !e.metaKey) {
    stepRing(e.key === "ArrowRight" ? 1 : -1);
  }
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
