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

const CLOSE_MS = 280;

export function createPanels(store: Store, ctl: Controller, fallbackFocus: HTMLElement) {
  const panel = required<HTMLElement>("#panel");
  const tag = required<HTMLElement>("#panel-tag", panel);
  const title = required<HTMLElement>("#panel-title", panel);
  const body = required<HTMLElement>("#panel-body", panel);
  required<HTMLButtonElement>("#panel-close", panel).addEventListener("click", () => ctl.dispatchCommand("back", "click"));

  let returnTo: HTMLElement | null = null;
  let closeTimer = 0;
  let shown: PanelId | null = null;

  function show(id: PanelId, wasOpen: boolean) {
    window.clearTimeout(closeTimer);
    const m = menuById(id);
    tag.textContent = m.en;
    title.textContent = m.label;
    body.replaceChildren(...builders[id](ctl));
    body.scrollTop = 0;
    panel.hidden = false;
    if (!wasOpen) {
      const active = document.activeElement;
      returnTo = active instanceof HTMLElement && !panel.contains(active) ? active : null;
      void panel.offsetWidth; // let the closed style apply before transitioning
    }
    panel.classList.add("is-open");
    title.focus({ preventScroll: true });
  }

  function hide() {
    panel.classList.remove("is-open");
    const target = returnTo && returnTo.isConnected && !returnTo.closest("[hidden]") ? returnTo : fallbackFocus;
    returnTo = null;
    const inside = panel.contains(document.activeElement);
    if (inside) target.focus({ preventScroll: true });
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      if (!store.get().activePanel) panel.hidden = true;
    }, CLOSE_MS);
  }

  store.subscribe((s) => {
    if (s.activePanel === shown) return;
    const wasOpen = shown !== null;
    shown = s.activePanel;
    if (s.activePanel) show(s.activePanel, wasOpen);
    else hide();
  });
}
