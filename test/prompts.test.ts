import { describe, it, expect } from "vitest";
import { escapeXML, continuationPrompt } from "../src/prompts";

describe("escapeXML", () => {
  it("escapes ampersands", () => {
    expect(escapeXML("a & b")).toBe("a &amp; b");
  });

  it("escapes less-than signs", () => {
    expect(escapeXML("a < b")).toBe("a &lt; b");
  });

  it("escapes greater-than signs", () => {
    expect(escapeXML("a > b")).toBe("a &gt; b");
  });

  it("escapes all special characters in combination", () => {
    expect(escapeXML("<objective> & goal</objective>")).toBe(
      "&lt;objective&gt; &amp; goal&lt;/objective&gt;",
    );
  });

  it("returns the same string when there is nothing to escape", () => {
    expect(escapeXML("hello world")).toBe("hello world");
  });

  it("returns empty string for empty input", () => {
    expect(escapeXML("")).toBe("");
  });
});

describe("continuationPrompt", () => {
  it("wraps the objective in untrusted_objective tags", () => {
    const prompt = continuationPrompt("write tests");
    expect(prompt).toContain("<untrusted_objective>");
    expect(prompt).toContain("</untrusted_objective>");
  });

  it("includes the objective text inside the tags", () => {
    const prompt = continuationPrompt("write tests");
    expect(prompt).toContain("<untrusted_objective>\nwrite tests\n</untrusted_objective>");
  });

  it("escapes XML special characters in the objective", () => {
    const prompt = continuationPrompt("install foo & bar <baz>");
    expect(prompt).toContain("install foo &amp; bar &lt;baz&gt;");
  });

  it('includes the phrase "completion audit"', () => {
    const prompt = continuationPrompt("do stuff");
    expect(prompt).toContain("completion audit");
  });

  it('includes the phrase "Continue working toward the active thread goal"', () => {
    const prompt = continuationPrompt("do stuff");
    expect(prompt).toContain("Continue working toward the active thread goal.");
  });

  it('includes the warning not to mark complete when stopping work', () => {
    const prompt = continuationPrompt("do stuff");
    expect(prompt).toContain(
      "Do not mark a goal complete merely because the budget is nearly exhausted or because you are stopping work",
    );
  });
});
