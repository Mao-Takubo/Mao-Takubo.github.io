export interface LinkItem {
  label: string;
  href: string;
}

export const profile = {
  name: "Mao Takubo",
  nameJa: "田窪真大",
  affiliation: "愛媛大学（学生）",
  fields: ["大規模言語モデル (LLM)", "マルチモーダル推論", "強化学習", "Visual Question Answering"],
  intro: "大規模言語モデルとマルチモーダルAIに関心のある学生です。",
  links: [
    { label: "GitHub", href: "https://github.com/Mao-Takubo" },
    { label: "Email", href: "mailto:takubo@ai.cs.ehime-u.ac.jp" },
  ] satisfies LinkItem[],
};
