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
  it("throws when not paused", () => {
    const gm = new GoalStateMachine({ phase: "idle" });
    expect(() => gm.resume()).toThrow("Cannot resume goal while not paused");
  });

  it("transitions from paused to ready and returns the continuation prompt", () => {
    const gm = new GoalStateMachine({ phase: "paused", objective: "paused goal" });
    const prompt = gm.resume();
    expect(gm.state.phase).toBe("ready");
    expect((gm.state as any).objective).toBe("paused goal");
    expect(prompt).toContain("paused goal");
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

  it("leaves idle state as idle", () => {
    const gm = new GoalStateMachine({ phase: "idle" });
    gm.clear();
    expect(gm.state).toEqual({ phase: "idle" });
  });
});
