import { palettes, type Palette } from "../config/theme";
import { el, required } from "./dom";

/** Row of round colour buttons; reports the chosen palette. */
export function createPalettePicker(initial: Palette, onChange: (p: Palette) => void) {
  const group = required<HTMLElement>("#palette");
  const buttons = new Map<string, HTMLButtonElement>();

  function mark(id: string) {
    for (const [pid, b] of buttons) b.setAttribute("aria-pressed", String(pid === id));
  }

  for (const p of palettes) {
    const b = el("button", "swatch");
    b.type = "button";
    b.dataset.id = p.id;
    if (!p.rainbow) b.style.setProperty("--swatch", p.glow); // rainbow swatch is a CSS gradient
    b.setAttribute("aria-label", `コアの色: ${p.label}`);
    b.title = p.label;
    b.addEventListener("click", () => {
      mark(p.id);
      onChange(p);
    });
    group.append(b);
    buttons.set(p.id, b);
  }
  mark(initial.id);
}
