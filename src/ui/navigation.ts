import { menus } from "../config/menus";
import { menuById } from "../config/menus";
import type { Controller } from "../app/commands";
import type { Store, AppState } from "../app/state";
import { el, required } from "./dom";

export interface Navigation {
  speakButton: HTMLButtonElement;
}

export function createNavigation(store: Store, ctl: Controller): Navigation {
  const app = required<HTMLElement>("#app");
  const nav = required<HTMLElement>("#menu");
  const speak = required<HTMLButtonElement>("#speak");
  const speakLabel = required<HTMLElement>("#speak-label");
  const mute = required<HTMLButtonElement>("#mute");
  const subtitle = required<HTMLElement>("#subtitle");
  const transcript = required<HTMLElement>("#transcript");
  const notice = required<HTMLElement>("#notice");
  const replay = required<HTMLButtonElement>("#replay");
  const live = required<HTMLElement>("#sr-live");
  const bootStart = required<HTMLButtonElement>("#boot-start");
  const bootSilent = required<HTMLButtonElement>("#boot-silent");
  const bootBox = required<HTMLElement>("#boot");

  const buttons = new Map<string, HTMLButtonElement>();
  for (const m of menus) {
    const b = el("button", "menu-btn");
    b.type = "button";
    b.dataset.id = m.id;
    b.append(el("span", "menu-label", m.label), el("span", "menu-en", m.en));
    b.addEventListener("click", () => ctl.dispatchCommand(m.id, "click"));
    nav.append(b);
    buttons.set(m.id, b);
  }

  speak.addEventListener("click", () => ctl.toggleListening());
  mute.addEventListener("click", () => ctl.setMuted(!store.get().muted));
  replay.addEventListener("click", () => ctl.replayBlocked());
  bootStart.addEventListener("click", () => ctl.boot(false));
  bootSilent.addEventListener("click", () => ctl.boot(true));
  required<HTMLElement>("#core-canvas").addEventListener("click", () => ctl.boot(false));

  function announce(text: string) {
    live.textContent = "";
    // re-set on the next tick so identical messages are announced again
    window.setTimeout(() => (live.textContent = text), 30);
  }

  function render(s: AppState, prev: AppState | null) {
    app.classList.toggle("is-booted", s.booted);
    bootBox.hidden = s.booted;
    app.dataset.voice = s.voiceState;
    app.dataset.panel = s.activePanel ?? "";

    subtitle.textContent = s.subtitle;
    transcript.textContent = s.transcript ? `認識: ${s.transcript}` : "";
    notice.textContent = s.notice ?? "";
    notice.hidden = !s.notice;
    replay.hidden = !s.blockedKey;

    speak.disabled = !s.recognitionSupported;
    speak.setAttribute("aria-pressed", String(s.voiceState === "listening"));
    speakLabel.textContent = s.voiceState === "listening" ? "LISTENING / 聞いています" : "SPEAK";
    mute.setAttribute("aria-pressed", String(s.muted));
    mute.textContent = s.muted ? "音声 OFF" : "音声 ON";

    for (const [id, b] of buttons) {
      b.classList.toggle("is-candidate", s.candidates.includes(id));
      if (id === s.activePanel) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    }
    buttons.get("back")!.hidden = s.activePanel === null;

    if (prev) {
      if (s.voiceState === "listening" && prev.voiceState !== "listening") announce("聞いています");
      else if (s.activePanel && s.activePanel !== prev.activePanel) announce(`${menuById(s.activePanel).label}を表示しました`);
      else if (!s.activePanel && prev.activePanel) announce("ホームに戻りました");
      else if (s.notice && s.notice !== prev.notice) announce(s.notice);
    }
  }

  store.subscribe(render);
  render(store.get(), null);
  return { speakButton: speak };
}
