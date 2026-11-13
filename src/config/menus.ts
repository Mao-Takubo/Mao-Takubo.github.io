export type PanelId = "status" | "research" | "publications" | "projects" | "contact" | "help";
export type CommandId = PanelId | "back";

export interface MenuItem {
  id: CommandId;
  label: string;
  en: string;
  aliases: string[];
  voiceKey: string;
}

/** Single source of truth for the menu buttons and for voice matching. */
export const menus: MenuItem[] = [
  {
    id: "status",
    label: "ステータス",
    en: "STATUS",
    aliases: ["ステータス", "プロフィール", "自己紹介", "status", "profile"],
    voiceKey: "status",
  },
  {
    id: "research",
    label: "研究",
    en: "RESEARCH",
    aliases: ["研究", "研究内容", "research"],
    voiceKey: "research",
  },
  {
    id: "publications",
    label: "業績",
    en: "PUBLICATIONS",
    aliases: ["業績", "論文", "発表", "論文一覧", "業績一覧", "publications"],
    voiceKey: "publications",
  },
  {
    id: "projects",
    label: "プロジェクト",
    en: "PROJECTS",
    aliases: ["プロジェクト", "作品", "制作物", "コード", "作ったもの", "projects"],
    voiceKey: "projects",
  },
  {
    id: "contact",
    label: "連絡先",
    en: "CONTACT",
    aliases: ["連絡先", "コンタクト", "メール", "連絡", "contact"],
    voiceKey: "contact",
  },
  {
    id: "help",
    label: "ヘルプ",
    en: "HELP",
    aliases: ["ヘルプ", "使い方", "何ができる", "選択肢", "help"],
    voiceKey: "help",
  },
  {
    id: "back",
    label: "戻る",
    en: "BACK",
    aliases: ["戻る", "閉じる", "ホーム", "最初に戻る", "back", "home"],
    voiceKey: "back",
  },
];

export const menuById = (id: CommandId): MenuItem => menus.find((m) => m.id === id)!;
