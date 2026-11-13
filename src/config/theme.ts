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
