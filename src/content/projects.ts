import type { LinkItem } from "./profile";

export interface Project {
  name: string;
  description: string;
  tech: string[];
  links: LinkItem[];
}

export const projects: Project[] = [
  {
    name: "MAO CORE",
    description: "声で操作する、このポートフォリオサイト。",
    tech: ["TypeScript", "Three.js", "Vite"],
    links: [{ label: "GitHub", href: "https://github.com/Mao-Takubo/Mao-Takubo.github.io" }],
  },
];
