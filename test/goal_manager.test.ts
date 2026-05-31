import { describe, it, expect, beforeEach } from "vitest";
import { GoalStateMachine } from "../src/goal_state_machine";
import { goalForSession, CUSTOM_TYPE } from "../src/goal_finder";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";

function makeEntry(
  overrides: Partial<SessionEntry> & { type: string; customType?: string; data?: unknown; details?: unknown },
): SessionEntry {
  const base = {
    id: crypto.randomUUID?.() ?? Math.random().toString(36),
    parentId: null,
    timestamp: new Date().toISOString(),
  };
  return { ...base, ...overrides } as unknown as SessionEntry;
}

function sessionManagerWith(entries: SessionEntry[]) {
  return { getEntries: () => entries };
}

// ---------------------------------------------------------------------------
// goalForSession (replaces GoalManager constructor)
// ---------------------------------------------------------------------------
describe("goalForSession", () => {
  it("defaults to idle when no entries exist", () => {
    const state = goalForSession(sessionManagerWith([]));
    expect(state).toEqual({ phase: "idle" });
  });

  it("defaults to idle when entries exist but none are goal entries", () => {
    const entries = [makeEntry({ type: "message" }), makeEntry({ type: "compaction" })];
    const state = goalForSession(sessionManagerWith(entries));
    expect(state).toEqual({ phase: "idle" });
  });

  it("reads ready state from the last matching custom entry", () => {
    const entries = [
      makeEntry({ type: "message" }),
      makeEntry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "ship it" } }),
    ];
    const state = goalForSession(sessionManagerWith(entries));
    expect(state).toEqual({ phase: "ready", objective: "ship it" });
  });

  it("reads paused state from the last matching custom entry", () => {
    const entries = [
      makeEntry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "paused", objective: "do thing" } }),
    ];
    const state = goalForSession(sessionManagerWith(entries));
    expect(state).toEqual({ phase: "paused", objective: "do thing" });
  });

  it("reads state from a custom_message entry (using details)", () => {
    const entries = [
      makeEntry({
        type: "custom_message",
        customType: CUSTOM_TYPE,
        details: { phase: "ready", objective: "via details" },
      }),
    ];
    const state = goalForSession(sessionManagerWith(entries));
    expect(state).toEqual({ phase: "ready", objective: "via details" });
  });

  it("picks the most recent matching entry (entries are reversed internally)", () => {
    const entries = [
      makeEntry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "idle" } }),
      makeEntry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "later" } }),
    ];
    const state = goalForSession(sessionManagerWith(entries));
    expect(state).toEqual({ phase: "ready", objective: "later" });
  });
});


// ---------------------------------------------------------------------------
// GoalStateMachine.start()
// ---------------------------------------------------------------------------
describe("GoalStateMachine.start", () => {
  let gm: GoalStateMachine;

  beforeEach(() => {
    gm = new GoalStateMachine({ phase: "idle" });
  });

  it("throws when not idle", async () => {
    gm.state = { phase: "ready", objective: "already running" };
    await expect(gm.start("new goal", () => false)).rejects.toThrow("Cannot set objective while not idle");
  });

  it("sets state to ready and returns a continuation prompt", async () => {
    const prompt = await gm.start("implement feature X", () => false);
    expect(gm.state.phase).toBe("ready");
    expect((gm.state as any).objective).toBe("implement feature X");
    expect(prompt).toBeDefined();
    expect(prompt).toContain("implement feature X");
  });
});

// ---------------------------------------------------------------------------
// resume()
// ---------------------------------------------------------------------------
describe("GoalStateMachine.resume", () => {
  it("throws when not paused or blocked", () => {
    const gm = new GoalStateMachine({ phase: "idle" });
    expect(() => gm.resume()).toThrow("Cannot resume goal while not paused or blocked");
  });

  it("transitions from paused to ready and returns the continuation prompt", () => {
    const gm = new GoalStateMachine({ phase: "paused", objective: "paused goal" });
    const prompt = gm.resume();
    expect(gm.state.phase).toBe("ready");
    expect((gm.state as any).objective).toBe("paused goal");
    expect(prompt).toContain("paused goal");
  });

  it("transitions from blocked to ready and returns the continuation prompt", () => {
    const gm = new GoalStateMachine({ phase: "blocked", objective: "blocked goal" });
    const prompt = gm.resume();
    expect(gm.state.phase).toBe("ready");
    expect((gm.state as any).objective).toBe("blocked goal");
    expect(prompt).toContain("blocked goal");
  });
});

// ---------------------------------------------------------------------------
// continue()
// ---------------------------------------------------------------------------
describe("GoalStateMachine.continue", () => {
  it("returns undefined when not ready", () => {
    const gm = new GoalStateMachine({ phase: "idle" });
    expect(gm.continue()).toBeUndefined();
    gm.state = { phase: "paused", objective: "paused" };
    expect(gm.continue()).toBeUndefined();
    gm.state = { phase: "blocked", objective: "blocked" };
    expect(gm.continue()).toBeUndefined();
  });

  it("returns the continuation prompt when ready (with toolsUsed)", () => {
    const gm = new GoalStateMachine({ phase: "ready", objective: "ongoing work", toolsUsed: 1 });
    const prompt = gm.continue();
    expect(prompt).toBeDefined();
    expect(prompt).toContain("ongoing work");
  });
});

// ---------------------------------------------------------------------------
// pause()
// ---------------------------------------------------------------------------
describe("GoalStateMachine.pause", () => {
  it("throws when not ready", () => {
    const gm = new GoalStateMachine({ phase: "idle" });
    expect(() => gm.pause()).toThrow("Cannot pause goal while not ready");
  });

  it("transitions from ready to paused", () => {
    const gm = new GoalStateMachine({ phase: "ready", objective: "active work" });
    gm.pause();
    expect(gm.state).toEqual({ phase: "paused", objective: "active work" });
  });
});

// ---------------------------------------------------------------------------
// complete()
// ---------------------------------------------------------------------------
describe("GoalStateMachine.complete", () => {
  it("throws when not ready", () => {
    const gm = new GoalStateMachine({ phase: "idle" });
    expect(() => gm.complete()).toThrow("Cannot complete goal while not ready");
    gm.state = { phase: "paused", objective: "paused" };
    expect(() => gm.complete()).toThrow("Cannot complete goal while not ready");
  });

  it("clears state to idle when ready", () => {
    const gm = new GoalStateMachine({ phase: "ready", objective: "finished work" });
    gm.complete();
    expect(gm.state).toEqual({ phase: "idle" });
  });
});

// ---------------------------------------------------------------------------
// block()
// ---------------------------------------------------------------------------
describe("GoalStateMachine.block", () => {
  it("throws when not ready", () => {
    const gm = new GoalStateMachine({ phase: "idle" });
    expect(() => gm.block()).toThrow("Cannot block goal while not ready");
    gm.state = { phase: "paused", objective: "paused" };
    expect(() => gm.block()).toThrow("Cannot block goal while not ready");
  });

  it("transitions from ready to blocked with reason", () => {
    const gm = new GoalStateMachine({ phase: "ready", objective: "active work" });
    gm.block("missing API key");
    expect(gm.state).toEqual({ phase: "blocked", objective: "active work", blocker: "missing API key" });
  });

  it("transitions from ready to blocked without reason", () => {
    const gm = new GoalStateMachine({ phase: "ready", objective: "active work" });
    gm.block();
    expect(gm.state).toEqual({ phase: "blocked", objective: "active work" });
  });

  it("normalizes empty string reason to undefined", () => {
    const gm = new GoalStateMachine({ phase: "ready", objective: "active work" });
    gm.block("");
    expect(gm.state).toEqual({ phase: "blocked", objective: "active work" });
  });

  it("normalizes whitespace-only reason to undefined", () => {
    const gm = new GoalStateMachine({ phase: "ready", objective: "active work" });
    gm.block("   ");
    expect(gm.state).toEqual({ phase: "blocked", objective: "active work" });
  });
});

// ---------------------------------------------------------------------------
// clear()
// ---------------------------------------------------------------------------
describe("GoalStateMachine.clear", () => {
  it("sets state to idle from ready", () => {
    const gm = new GoalStateMachine({ phase: "ready", objective: "some goal" });
    gm.clear();
    expect(gm.state).toEqual({ phase: "idle" });
  });

  it("sets state to idle from paused", () => {
    const gm = new GoalStateMachine({ phase: "paused", objective: "paused goal" });
    gm.clear();
    expect(gm.state).toEqual({ phase: "idle" });
  });

  it("sets state to idle from blocked", () => {
    const gm = new GoalStateMachine({ phase: "blocked", objective: "blocked goal" });
    gm.clear();
    expect(gm.state).toEqual({ phase: "idle" });
  });

  it("leaves idle state as idle", () => {
    const gm = new GoalStateMachine({ phase: "idle" });
    gm.clear();
    expect(gm.state).toEqual({ phase: "idle" });
  });
});

// ---------------------------------------------------------------------------
// abort()
// ---------------------------------------------------------------------------
describe("GoalStateMachine.abort", () => {
  it("returns false when idle", () => {
    const gm = new GoalStateMachine({ phase: "idle" });
    expect(gm.abort()).toBe(false);
  });

  it("returns false when paused", () => {
    const gm = new GoalStateMachine({ phase: "paused", objective: "paused goal" });
    expect(gm.abort()).toBe(false);
  });

  it("returns false when blocked", () => {
    const gm = new GoalStateMachine({ phase: "blocked", objective: "blocked goal" });
    expect(gm.abort()).toBe(false);
  });

  it("returns true and pauses when ready", () => {
    const gm = new GoalStateMachine({ phase: "ready", objective: "active goal" });
    expect(gm.abort()).toBe(true);
    expect(gm.state.phase).toBe("paused");
    expect((gm.state as any).objective).toBe("active goal");
  });
});

// ---------------------------------------------------------------------------
// start() from blocked
// ---------------------------------------------------------------------------
describe("GoalStateMachine.start from blocked", () => {
  it("allows override from blocked with confirmation", async () => {
    const gm = new GoalStateMachine({ phase: "blocked", objective: "old goal" });
    const prompt = await gm.start("new goal", () => true);
    expect(gm.state.phase).toBe("ready");
    expect((gm.state as any).objective).toBe("new goal");
    expect(prompt).toContain("new goal");
  });

  it("throws when blocked and confirmation is false", async () => {
    const gm = new GoalStateMachine({ phase: "blocked", objective: "old goal" });
    await expect(gm.start("new goal", () => false)).rejects.toThrow("Cannot set objective while not idle");
  });
});

// ---------------------------------------------------------------------------
// goalForSession with blocked state
// ---------------------------------------------------------------------------
describe("goalForSession blocked", () => {
  it("reads blocked state from the last matching custom entry", () => {
    const entries = [
      makeEntry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "blocked", objective: "stuck", blocker: "missing key" } }),
    ];
    const state = goalForSession(sessionManagerWith(entries));
    expect(state).toEqual({ phase: "blocked", objective: "stuck", blocker: "missing key" });
  });

  it("reads blocked state without blocker", () => {
    const entries = [
      makeEntry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "blocked", objective: "stuck" } }),
    ];
    const state = goalForSession(sessionManagerWith(entries));
    expect(state).toEqual({ phase: "blocked", objective: "stuck" });
  });
});
