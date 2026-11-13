import type { LinkItem } from "./profile";

export interface Publication {
  title: string;
  authors: string;
  venue: string;
  year: number;
  status?: string;
  links?: LinkItem[];
}

/** 確認できた業績だけを追加してください。空のときは「準備中」と表示されます。 */
export const publications: Publication[] = [];
