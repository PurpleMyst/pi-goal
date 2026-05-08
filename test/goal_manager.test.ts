import { describe, it, expect, beforeEach } from "vitest";
import { GoalManager, CUSTOM_TYPE, goalWidget } from "../src/goal_manager";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";

function makeEntry(
  overrides: Partial<SessionEntry> & { type: string; customType?: string; data?: unknown; details?: unknown },
): SessionEntry {
  const base = {
    id: crypto.randomUUID?.() ?? Math.random().toString(36),
    parentId: null,
    timestamp: new Date().toISOString(),
  };
  // The actual values for the disjoint union — we spread overrides and cast
  return { ...base, ...overrides } as unknown as SessionEntry;
}

function sessionManagerWith(entries: SessionEntry[]) {
  return { getEntries: () => entries };
}

// ---------------------------------------------------------------------------
// constructor
// ---------------------------------------------------------------------------
describe("GoalManager constructor", () => {
  it("defaults to idle when no entries exist", () => {
    const gm = new GoalManager(sessionManagerWith([]));
    expect(gm.state).toEqual({ phase: "idle" });
  });

  it("defaults to idle when entries exist but none are goal entries", () => {
    const entries = [makeEntry({ type: "message" }), makeEntry({ type: "compaction" })];
    const gm = new GoalManager(sessionManagerWith(entries));
    expect(gm.state).toEqual({ phase: "idle" });
  });

  it("reads ready state from the last matching custom entry", () => {
    const entries = [
      makeEntry({ type: "message" }),
      makeEntry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "ship it" } }),
    ];
    const gm = new GoalManager(sessionManagerWith(entries));
    expect(gm.state).toEqual({ phase: "ready", objective: "ship it" });
  });

  it("reads paused state from the last matching custom entry", () => {
    const entries = [
      makeEntry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "paused", objective: "do thing" } }),
    ];
    const gm = new GoalManager(sessionManagerWith(entries));
    expect(gm.state).toEqual({ phase: "paused", objective: "do thing" });
  });

  it("reads state from a custom_message entry (using details)", () => {
    const entries = [
      makeEntry({
        type: "custom_message",
        customType: CUSTOM_TYPE,
        details: { phase: "ready", objective: "via details" },
      }),
    ];
    const gm = new GoalManager(sessionManagerWith(entries));
    expect(gm.state).toEqual({ phase: "ready", objective: "via details" });
  });

  it("picks the most recent matching entry (entries are reversed internally)", () => {
    // Earlier entry says idle, later entry says ready → ready wins
    const entries = [
      makeEntry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "idle" } }),
      makeEntry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "later" } }),
    ];
    const gm = new GoalManager(sessionManagerWith(entries));
    expect(gm.state).toEqual({ phase: "ready", objective: "later" });
  });
});

// ---------------------------------------------------------------------------
// goalWidget()
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// start()
// ---------------------------------------------------------------------------
describe("GoalManager.start", () => {
  let gm: GoalManager;

  beforeEach(() => {
    gm = new GoalManager(sessionManagerWith([]));
  });

  it("throws when not idle", () => {
    gm.state = { phase: "ready", objective: "already running" };
    expect(() => gm.start("new goal")).toThrow("Cannot set objective while not idle");
  });

  it("sets state to ready and returns a continuation prompt", () => {
    const prompt = gm.start("implement feature X");
    expect(gm.state).toEqual({ phase: "ready", objective: "implement feature X" });
    expect(prompt).toBeDefined();
    expect(prompt).toContain("implement feature X");
  });
});

// ---------------------------------------------------------------------------
// resume()
// ---------------------------------------------------------------------------
describe("GoalManager.resume", () => {
  it("throws when not paused", () => {
    const gm = new GoalManager(sessionManagerWith([]));
    expect(() => gm.resume()).toThrow("Cannot resume goal while not paused");
  });

  it("transitions from paused to ready and returns the continuation prompt", () => {
    const gm = new GoalManager(sessionManagerWith([]));
    gm.state = { phase: "paused", objective: "paused goal" };
    const prompt = gm.resume();
    expect(gm.state).toEqual({ phase: "ready", objective: "paused goal" });
    expect(prompt).toContain("paused goal");
  });
});

// ---------------------------------------------------------------------------
// continue()
// ---------------------------------------------------------------------------
describe("GoalManager.continue", () => {
  it("returns undefined when not ready", () => {
    const gm = new GoalManager(sessionManagerWith([]));
    expect(gm.continue()).toBeUndefined();
    gm.state = { phase: "paused", objective: "paused" };
    expect(gm.continue()).toBeUndefined();
  });

  it("returns the continuation prompt when ready", () => {
    const gm = new GoalManager(sessionManagerWith([]));
    gm.state = { phase: "ready", objective: "ongoing work" };
    const prompt = gm.continue();
    expect(prompt).toBeDefined();
    expect(prompt).toContain("ongoing work");
  });
});

// ---------------------------------------------------------------------------
// pause()
// ---------------------------------------------------------------------------
describe("GoalManager.pause", () => {
  it("throws when not ready", () => {
    const gm = new GoalManager(sessionManagerWith([]));
    expect(() => gm.pause()).toThrow("Cannot pause goal while not ready");
  });

  it("transitions from ready to paused", () => {
    const gm = new GoalManager(sessionManagerWith([]));
    gm.state = { phase: "ready", objective: "active work" };
    gm.pause();
    expect(gm.state).toEqual({ phase: "paused", objective: "active work" });
  });
});

// ---------------------------------------------------------------------------
// complete()
// ---------------------------------------------------------------------------
describe("GoalManager.complete", () => {
  it("throws when not ready", () => {
    const gm = new GoalManager(sessionManagerWith([]));
    expect(() => gm.complete()).toThrow("Cannot complete goal while not ready");
    gm.state = { phase: "paused", objective: "paused" };
    expect(() => gm.complete()).toThrow("Cannot complete goal while not ready");
  });

  it("clears state to idle when ready", () => {
    const gm = new GoalManager(sessionManagerWith([]));
    gm.state = { phase: "ready", objective: "finished work" };
    gm.complete();
    expect(gm.state).toEqual({ phase: "idle" });
  });
});

// ---------------------------------------------------------------------------
// clear()
// ---------------------------------------------------------------------------
describe("GoalManager.clear", () => {
  it("sets state to idle from ready", () => {
    const gm = new GoalManager(sessionManagerWith([]));
    gm.state = { phase: "ready", objective: "some goal" };
    gm.clear();
    expect(gm.state).toEqual({ phase: "idle" });
  });

  it("sets state to idle from paused", () => {
    const gm = new GoalManager(sessionManagerWith([]));
    gm.state = { phase: "paused", objective: "paused goal" };
    gm.clear();
    expect(gm.state).toEqual({ phase: "idle" });
  });

  it("leaves idle state as idle", () => {
    const gm = new GoalManager(sessionManagerWith([]));
    gm.clear();
    expect(gm.state).toEqual({ phase: "idle" });
  });
});
