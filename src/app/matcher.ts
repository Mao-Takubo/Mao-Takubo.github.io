import { menus, type CommandId } from "../config/menus";

export type MatchResult =
  | { type: "match"; id: CommandId }
  | { type: "ambiguous"; candidates: CommandId[] }
  | { type: "unknown" };

const NEGATION = /(ない|ません|やめ|いらない|不要|ではなく|じゃなく)/;
const LEADING = /^(ちょっと|あの|えっと|じゃあ|では|それでは|まず|次は|次に|もう一度)/;
const TRAILING =
  /(を?(見せて|みせて|表示して|表示|開いて|ひらいて|開く|教えて|おしえて|見たい|みたい|見る|知りたい)|お願い(します)?|ください|くれ|して|ほしい|です|ます|を|は|が|の|に|で|も)$/;
const MAX_RESIDUAL = 6;

/** NFKC, lowercase, drop whitespace/punctuation, fold katakana to hiragana. */
export function normalize(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

const aliasIndex = menus.flatMap((m) => m.aliases.map((a) => ({ id: m.id, alias: normalize(a) })));

function strip(text: string): string {
  let t = text;
  for (let i = 0; i < 8; i++) {
    const next = t.replace(LEADING, "").replace(TRAILING, "");
    if (next === t || next === "") break;
    t = next;
  }
  return t;
}

export function matchCommand(raw: string): MatchResult {
  const text = normalize(raw);
  if (!text || NEGATION.test(text)) return { type: "unknown" };

  // 1. exact alias
  const exact = new Set(aliasIndex.filter((a) => a.alias === text).map((a) => a.id));
  if (exact.size === 1) return { type: "match", id: [...exact][0]! };

  // 2. exact alias after removing request phrasing
  const stripped = strip(text);
  const viaStrip = new Set(aliasIndex.filter((a) => a.alias === stripped).map((a) => a.id));
  if (viaStrip.size === 1) return { type: "match", id: [...viaStrip][0]! };

  // 3. keyword containment: act only when exactly one command is mentioned
  //    and little else was said.
  const hits = aliasIndex.filter((a) => a.alias.length >= 2 && text.includes(a.alias));
  const ids = [...new Set(hits.map((h) => h.id))];
  if (ids.length > 1) return { type: "ambiguous", candidates: ids };
  if (ids.length === 1) {
    const longest = hits.reduce((a, b) => (b.alias.length > a.alias.length ? b : a));
    const residual = strip(text.replace(longest.alias, ""));
    if (residual.length <= MAX_RESIDUAL) return { type: "match", id: ids[0]! };
  }
  return { type: "unknown" };
}
