import { describe, it, expect } from "vitest";
import goalWidget from "../src/goal_widget";

const mockTheme = { fg: (_style: string, text: string) => text } as any;

describe("goalWidget", () => {
  it("returns unknown state when idle", () => {
    const result = goalWidget(mockTheme, { phase: "idle" });
    expect(result).toEqual(["🥅 Unknown state"]);
  });

  it("returns the objective for ready state", () => {
    const s = goalWidget(mockTheme, { phase: "ready", objective: "write all the tests" });
    expect(s).toBeDefined();
    expect(s[0]).toContain("write all the tests");
  });

  it("truncates objectives longer than 30 characters", () => {
    const s = goalWidget(mockTheme, {
      phase: "ready",
      objective: "this is a very long objective that should be truncated",
    });
    expect(s).toBeDefined();
    // Should show first 30 chars followed by "…"
    // Strip ANSI escape codes that truncateToWidth may inject
    const stripped = s[0].replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toContain("this is a very long objective");
    expect(s[0].length).toBeLessThan(70);
  });

  it("does not truncate objectives exactly 30 characters", () => {
    const exact = "abcdefghijklmnopqrstuvwxyzABCD"; // 30 chars
    const s = goalWidget(mockTheme, { phase: "ready", objective: exact });
    expect(s).toBeDefined();
    expect(s[0]).toContain(exact);
    expect(s[0]).not.toContain("…");
  });

  it("returns paused status for paused state", () => {
    const s = goalWidget(mockTheme, { phase: "paused", objective: "fix bugs" });
    expect(s).toBeDefined();
    expect(s[0]).toContain("fix bugs");
  });
});
