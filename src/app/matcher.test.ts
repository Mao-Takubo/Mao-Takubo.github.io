import { describe, expect, it } from "vitest";
import { matchCommand } from "./matcher";

const id = (s: string) => {
  const r = matchCommand(s);
  return r.type === "match" ? r.id : r.type;
};

describe("matchCommand", () => {
  it("matches exact aliases", () => {
    expect(id("ステータス")).toBe("status");
    expect(id("研究")).toBe("research");
    expect(id("論文一覧")).toBe("publications");
    expect(id("戻る")).toBe("back");
  });
  it("handles request phrasing", () => {
    expect(id("ステータスを見せて")).toBe("status");
    expect(id("プロフィールを見せて")).toBe("status");
    expect(id("研究内容を表示して")).toBe("research");
    expect(id("連絡先を教えてください")).toBe("contact");
    expect(id("ちょっとヘルプをお願いします")).toBe("help");
  });
  it("folds katakana/hiragana and width", () => {
    expect(id("すてーたす")).toBe("status");
    expect(id("ＨＥＬＰ")).toBe("help");
  });
  it("accepts katakana/English readings and hiragana", () => {
    expect(id("リサーチ")).toBe("research");
    expect(id("リサーチを見せて")).toBe("research");
    expect(id("パブリケーションズ")).toBe("publications");
    expect(id("パブリケーション")).toBe("publications");
    expect(id("Publications")).toBe("publications");
    expect(id("ぎょうせき")).toBe("publications");
    expect(id("けんきゅう")).toBe("research");
  });
  it("reports ambiguity instead of picking one", () => {
    expect(matchCommand("ステータスと研究")).toEqual({
      type: "ambiguous",
      candidates: ["status", "research"],
    });
  });
  it("ignores negation and unknown speech", () => {
    expect(id("研究は開かない")).toBe("unknown");
    expect(id("今日の天気はどうですか")).toBe("unknown");
    expect(id("")).toBe("unknown");
  });
  it("does not fire on long sentences that merely mention a keyword", () => {
    expect(id("昨日の夜ご飯の話をする前に研究")).toBe("unknown");
  });
});
