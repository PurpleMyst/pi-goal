import { describe, it, expect } from "vitest";
import { goalWidget } from "../src/goal_widget";

describe("goalWidget", () => {
  it("returns undefined when idle", () => {
    expect(goalWidget({ phase: "idle" })).toBeUndefined();
  });

  it("returns the objective for ready state", () => {
    const s = goalWidget({ phase: "ready", objective: "write all the tests" });
    expect(s).toBeDefined();
    expect(s![0]).toContain("write all the tests");
  });

  it("truncates objectives longer than 30 characters", () => {
    const s = goalWidget({
      phase: "ready",
      objective: "this is a very long objective that should be truncated",
    });
    expect(s).toBeDefined();
    // Should show first 30 chars followed by "..."
    expect(s![0]).toContain("this is a very long objective ...");
  });

  it("does not truncate objectives exactly 30 characters", () => {
    const exact = "abcdefghijklmnopqrstuvwxyzABCD"; // 30 chars
    const s = goalWidget({ phase: "ready", objective: exact });
    expect(s).toBeDefined();
    expect(s![0]).toContain(exact);
    expect(s![0]).not.toContain("...");
  });

  it("returns paused status for paused state", () => {
    const s = goalWidget({ phase: "paused", objective: "fix bugs" });
    expect(s).toBeDefined();
    expect(s![0]).toContain("Paused objective");
  });
});
