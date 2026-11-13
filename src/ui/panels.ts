import { menuById, menus, type PanelId } from "../config/menus";
import { profile } from "../content/profile";
import { research } from "../content/research";
import { publications } from "../content/publications";
import { projects } from "../content/projects";
import { contact } from "../content/contact";
import type { Controller } from "../app/commands";
import type { Store } from "../app/state";
import { el, link, required } from "./dom";

type Builder = (ctl: Controller) => HTMLElement[];

const empty = (text: string) => el("p", "empty", text);

function dl(rows: [string, string | HTMLElement][]): HTMLElement {
  const list = el("dl", "kv");
  for (const [k, v] of rows) {
    list.append(el("dt", undefined, k));
    const dd = el("dd");
    dd.append(v);
    list.append(dd);
  }
  return list;
}

const linkList = (links: { label: string; href: string }[]) => {
  const ul = el("ul", "links");
  for (const l of links) {
    const li = el("li");
    li.append(link(l.label, l.href));
    ul.append(li);
  }
  return ul;
};

const builders: Record<PanelId, Builder> = {
  status: () => [
    dl([
      ["NAME", `${profile.name} / ${profile.nameJa}`],
      ["AFFILIATION", profile.affiliation],
      ["FIELDS", profile.fields.join(" ・ ")],
    ]),
    el("p", undefined, profile.intro),
    linkList(profile.links),
  ],
  research: () => {
    const out: HTMLElement[] = [];
    for (const t of research.themes) {
      const block = el("div", "block");
      block.append(el("h3", undefined, t.title));
      if (t.summary) block.append(el("p", undefined, t.summary));
      out.push(block);
    }
    out.push(el("p", "empty", research.note));
    if (research.links.length) out.push(linkList(research.links));
    return out;
  },
  publications: () => {
    if (publications.length === 0) return [empty("業績は準備中です。")];
    return publications.map((p) => {
      const block = el("div", "block");
      block.append(el("h3", undefined, p.title));
      block.append(el("p", "meta", `${p.authors} — ${p.venue}, ${p.year}${p.status ? `（${p.status}）` : ""}`));
      if (p.links?.length) block.append(linkList(p.links));
      return block;
    });
  },
  projects: () => {
    if (projects.length === 0) return [empty("プロジェクトは準備中です。")];
    return projects.map((p) => {
      const block = el("div", "block");
      block.append(el("h3", undefined, p.name));
      block.append(el("p", undefined, p.description));
      block.append(el("p", "meta", p.tech.join(" / ")));
      block.append(linkList(p.links));
      return block;
    });
  },
  contact: () => [el("p", undefined, "連絡は次の方法でお願いします。"), linkList(contact.links)],
  help: (ctl) => {
    const out: HTMLElement[] = [
      el("p", undefined, "SPEAKを押して項目名を話すか、下のボタンをクリックしてください。Escapeで閉じます。"),
    ];
    const ul = el("ul", "help-list");
    for (const m of menus) {
      const li = el("li");
      const b = el("button", "help-item", `${m.label}`);
      b.type = "button";
      b.addEventListener("click", () => ctl.dispatchCommand(m.id, "click"));
      li.append(b, el("span", "meta", `「${m.aliases.slice(0, 3).join("」「")}」`));
      ul.append(li);
    }
    out.push(ul);
    const credit = el("p", "meta credit");
    credit.append(
      "音声合成：Open JTalk / pyopenjtalk-plus、HTS Voice \"Mei\"（MMDAgent Project Team）。Voice model © 2009–2013 Nagoya Institute of Technology / ",
      link("CC BY 3.0", "https://creativecommons.org/licenses/by/3.0/"),
      "。ピッチ・速度の変更と音響エフェクトを適用しています。本人の声ではありません。",
    );
    out.push(credit);
    return out;
  },
};

const REVEAL_DELAY = 700; // ms before the frame starts to grow
const REVEAL_MS = 650;

interface Origin {
  x: number;
  y: number;
}

/**
 * Opening: a copy of the core pulls away, flies to where the panel will be, and
 * dissolves into it as the frame grows from a line; content then fades in.
 */
export function createPanels(store: Store, ctl: Controller, fallbackFocus: HTMLElement, getOrigin: () => Origin | null, onSpawn?: () => void) {
  const app = required<HTMLElement>("#app");
  const panel = required<HTMLElement>("#panel");
  const inner = required<HTMLElement>(".panel-inner", panel);
  const tag = required<HTMLElement>("#panel-tag", panel);
  const title = required<HTMLElement>("#panel-title", panel);
  const body = required<HTMLElement>("#panel-body", panel);
  required<HTMLButtonElement>("#panel-close", panel).addEventListener("click", () => ctl.dispatchCommand("back", "click"));
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  let returnTo: HTMLElement | null = null;
  let shown: PanelId | null = null;
  let running: Animation[] = [];
  let orb: HTMLElement | null = null;

  function cancelRunning() {
    running.forEach((a) => a.cancel());
    running = [];
    orb?.remove();
    orb = null;
  }
  const play = (target: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    const a = target.animate(keyframes, { fill: "backwards", ...options });
    running.push(a);
    return a;
  };
  const contentItems = () => [...panel.querySelectorAll<HTMLElement>(".panel-head > *, .panel-body > *")];

  function revealContent(startAt: number, each = 70, duration = 450) {
    contentItems().forEach((node, i) =>
      play(node, [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], {
        delay: startAt + Math.min(i, 8) * each,
        duration,
        easing: "cubic-bezier(.2,.7,.2,1)",
      }),
    );
  }

  function spawnAndGrow() {
    const rect = panel.getBoundingClientRect();
    const to = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const from = getOrigin() ?? { x: innerWidth * 0.3, y: innerHeight * 0.5 };
    const half = 28;
    const at = (x: number, y: number, scale: number) => `translate(${x - half}px, ${y - half}px) scale(${scale})`;
    const mid = { x: from.x + (to.x - from.x) * 0.5, y: Math.min(from.y, to.y) - Math.min(90, innerHeight * 0.12) };

    orb = el("div", "spawn-orb");
    app.append(orb);
    onSpawn?.();
    play(orb, [
      { transform: at(from.x, from.y, 0.15), opacity: 0, offset: 0 },
      { transform: at(from.x, from.y, 1), opacity: 1, offset: 0.2 },
      { transform: at(mid.x, mid.y, 0.9), opacity: 1, offset: 0.6 },
      { transform: at(to.x, to.y, 1.1), opacity: 1, offset: 0.9 },
      { transform: at(to.x, to.y, 3.2), opacity: 0, offset: 1 },
    ], { duration: REVEAL_DELAY + 450, easing: "cubic-bezier(.45,.05,.25,1)", fill: "both" }).finished.then(() => orb?.remove(), () => {});

    // the frame grows from a thin line at the orb's landing point
    const glowFilter = getComputedStyle(panel).filter;
    play(panel, [
      { clipPath: "inset(50% 50% 50% 50%)", opacity: 0, filter: "drop-shadow(0 0 0 transparent)", offset: 0 },
      { clipPath: "inset(50% 0% 50% 0%)", opacity: 1, offset: 0.35 },
      { clipPath: "inset(0% 0% 0% 0%)", opacity: 1, filter: glowFilter, offset: 1 },
    ], { delay: REVEAL_DELAY, duration: REVEAL_MS, easing: "cubic-bezier(.3,.6,.2,1)" });
    const line = getComputedStyle(inner).borderTopColor;
    play(inner, [{ borderColor: getComputedStyle(document.documentElement).getPropertyValue("--highlight").trim() || line }, { borderColor: line }], {
      delay: REVEAL_DELAY, duration: REVEAL_MS + 500, easing: "ease-out",
    });
    revealContent(REVEAL_DELAY + REVEAL_MS * 0.7);
  }

  function show(id: PanelId, wasOpen: boolean) {
    cancelRunning();
    const m = menuById(id);
    tag.textContent = m.en;
    title.textContent = m.label;
    body.replaceChildren(...builders[id](ctl));
    body.scrollTop = 0;
    panel.hidden = false;
    if (!wasOpen) {
      const active = document.activeElement;
      returnTo = active instanceof HTMLElement && active !== document.body && !panel.contains(active) ? active : null;
    }
    title.focus({ preventScroll: true });
    if (reduceMotion.matches) return;
    if (wasOpen) revealContent(0, 50, 350); // already open: just re-form the contents
    else spawnAndGrow();
  }

  function hide() {
    cancelRunning();
    const target = returnTo && returnTo.isConnected && !returnTo.closest("[hidden]") ? returnTo : fallbackFocus;
    returnTo = null;
    if (panel.contains(document.activeElement)) target.focus({ preventScroll: true });
    if (reduceMotion.matches) {
      panel.hidden = true;
      return;
    }
    const closing = panel.animate(
      [
        { clipPath: "inset(0% 0% 0% 0%)", opacity: 1 },
        { clipPath: "inset(50% 0% 50% 0%)", opacity: 1, offset: 0.55 },
        { clipPath: "inset(50% 50% 50% 50%)", opacity: 0 },
      ],
      { duration: 380, easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" },
    );
    running.push(closing);
    closing.finished.then(
      () => {
        if (!store.get().activePanel) panel.hidden = true;
        closing.cancel();
      },
      () => {},
    );
  }

  store.subscribe((s) => {
    if (s.activePanel === shown) return;
    const wasOpen = shown !== null;
    shown = s.activePanel;
    if (s.activePanel) show(s.activePanel, wasOpen);
    else hide();
  });
}
