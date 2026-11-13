/** Colours and render-quality presets. Mirrored into CSS custom properties at startup. */
export const theme = {
  bg: "#050507",
  panel: "#111017",
  glow: "#FF9D23",
  highlight: "#FFE2A1",
  line: "#8A501E",
  text: "#F3EBDD",
  textDim: "#B9ABA0",
  /** global multiplier for bloom / emissive strength */
  glowStrength: 1,
};

export interface Quality {
  particles: number;
  maxDpr: number;
  bloom: boolean;
  bloomScale: number;
  links: number;
}

export const qualities: Record<"standard" | "light" | "minimal", Quality> = {
  standard: { particles: 900, maxDpr: 1.5, bloom: true, bloomScale: 1, links: 70 },
  light: { particles: 250, maxDpr: 1, bloom: true, bloomScale: 0.5, links: 24 },
  minimal: { particles: 120, maxDpr: 1, bloom: false, bloomScale: 0.5, links: 12 },
};

export interface Palette {
  id: string;
  label: string;
  glow: string;
  highlight: string;
  line: string;
  /** colours cycle over time and spread across the core */
  rainbow?: boolean;
}

export const palettes: Palette[] = [
  { id: "amber", label: "AMBER", glow: "#FF9D23", highlight: "#FFE2A1", line: "#8A501E" },
  { id: "gold", label: "GOLD", glow: "#FFC82E", highlight: "#FFF0B0", line: "#8A6A12" },
  { id: "cyan", label: "CYAN", glow: "#28D7FF", highlight: "#B8F3FF", line: "#14697F" },
  { id: "crimson", label: "CRIMSON", glow: "#FF3B4E", highlight: "#FFB3BA", line: "#7A1C28" },
  { id: "violet", label: "VIOLET", glow: "#A56BFF", highlight: "#E1CCFF", line: "#503187" },
  { id: "emerald", label: "EMERALD", glow: "#2DFF8E", highlight: "#C4FFE0", line: "#12794A" },
  { id: "ice", label: "ICE", glow: "#BFE6FF", highlight: "#FFFFFF", line: "#5A7A95" },
  { id: "rainbow", label: "RAINBOW", glow: "#FF9D23", highlight: "#FFE2A1", line: "#8A501E", rainbow: true },
];

export const defaultPalette = palettes[0]!;

/** Base hue (0..1) of the rainbow at time `t` seconds; frozen when motion is reduced. */
export const rainbowHue = (t: number, reduceMotion: boolean): number => (reduceMotion ? 0.55 : (t * 0.04) % 1);

/** CSS colours for the rainbow palette (HUD, panel borders, buttons). */
export function rainbowCss(hue: number): Pick<Palette, "glow" | "highlight" | "line"> {
  const h = (hue * 360) % 360;
  return { glow: `hsl(${h} 100% 58%)`, highlight: `hsl(${h} 100% 82%)`, line: `hsl(${h} 70% 32%)` };
}

export function applyPaletteToCss(p: Pick<Palette, "glow" | "highlight" | "line">, root: HTMLElement = document.documentElement): void {
  root.style.setProperty("--glow", p.glow);
  root.style.setProperty("--highlight", p.highlight);
  root.style.setProperty("--line", p.line);
}

export function applyThemeToCss(root: HTMLElement = document.documentElement): void {
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  set("--bg", theme.bg);
  set("--panel", theme.panel);
  set("--glow", theme.glow);
  set("--highlight", theme.highlight);
  set("--line", theme.line);
  set("--text", theme.text);
  set("--text-dim", theme.textDim);
}
