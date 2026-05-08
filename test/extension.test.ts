import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";
import extension from "../src/extension";
import { CUSTOM_TYPE } from "../src/goal_finder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SessionEntry-like object for use in getEntries(). */
function entry(overrides: Partial<SessionEntry> & { type: string; customType?: string; data?: unknown; details?: unknown }): SessionEntry {
  const base = {
    id: crypto.randomUUID?.() ?? Math.random().toString(36),
    parentId: null,
    timestamp: new Date().toISOString(),
  };
  return { ...base, ...overrides } as unknown as SessionEntry;
}

type CapturedCommand = {
  name: string;
  handler: (args: string, ctx: any) => Promise<void>;
};

type CapturedTool = {
  name: string;
  execute: (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) => Promise<any>;
};

type CapturedHandler = {
  event: string;
  handler: (event: any, ctx: any) => Promise<void> | void;
};

interface MockAPI {
  commands: CapturedCommand[];
  tools: CapturedTool[];
  handlers: CapturedHandler[];
  appendEntryCalls: { customType: string; data: unknown }[];
  sendMessageCalls: { message: any; options: any }[];
  activeTools: string[];
  setActiveToolsCalls: string[][];
  notifyCalls: { message: string; type?: string }[];
  setWidgetCalls: { key: string; content: any }[];
  getEntries: () => SessionEntry[];
}

const mockTheme = { fg: (_style: string, text: string) => text };

/** Create a mock ExtensionAPI wired to a shared MockAPI state bag. */
function createMockAPI(bag: MockAPI): ExtensionAPI {
  const sessionManager = { getEntries: () => bag.getEntries() };

  const ui = {
    notify: (message: string, type?: string) => {
      bag.notifyCalls.push({ message, type });
    },
    setWidget: (key: string, content: any) => {
      bag.setWidgetCalls.push({ key, content });
    },
    theme: mockTheme,
    confirm: (_title: string, _message: string) => Promise.resolve(true),
  };

  const api = {
    registerCommand(name: string, options: any) {
      bag.commands.push({ name, handler: options.handler });
    },
    registerTool(tool: any) {
      bag.tools.push({ name: tool.name, execute: tool.execute });
    },
    on(event: string, handler: any) {
      bag.handlers.push({ event, handler });
    },
    appendEntry(customType: string, data?: unknown) {
      bag.appendEntryCalls.push({ customType, data });
    },
    sendMessage(message: any, options?: any) {
      bag.sendMessageCalls.push({ message, options });
    },
    getActiveTools() {
      return bag.activeTools;
    },
    setActiveTools(toolNames: string[]) {
      bag.setActiveToolsCalls.push(toolNames);
      bag.activeTools = toolNames;
    },
  } as unknown as ExtensionAPI;

  // Patch context factory onto the mock so tests can build ctx objects
  (api as any).sessionManager = sessionManager;
  (api as any).ui = ui;

  return api;
}

function buildCtx(bag: MockAPI, overrides: Record<string, unknown> = {}) {
  const sessionManager = { getEntries: () => bag.getEntries() };
  return {
    sessionManager,
    ui: {
      notify: (message: string, type?: string) => {
        bag.notifyCalls.push({ message, type });
      },
      setWidget: (key: string, content: any) => {
        bag.setWidgetCalls.push({ key, content });
      },
      theme: mockTheme,
      confirm: (_title: string, _message: string) => Promise.resolve(true),
    },
    hasUI: true,
    cwd: "/test",
    modelRegistry: {} as any,
    model: undefined,
    isIdle: () => true,
    signal: undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    shutdown: () => {},
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extension", () => {
  let bag: MockAPI;
  let pi: ExtensionAPI;

  beforeEach(() => {
    vi.useFakeTimers();

    bag = {
      commands: [],
      tools: [],
      handlers: [],
      appendEntryCalls: [],
      sendMessageCalls: [],
      activeTools: [],
      setActiveToolsCalls: [],
      notifyCalls: [],
      setWidgetCalls: [],
      getEntries: () => [],
    };
    pi = createMockAPI(bag);
    extension(pi);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -- registration ---------------------------------------------------------

  it("registers the goal command", () => {
    expect(bag.commands.some(c => c.name === "goal")).toBe(true);
  });

  it("registers event handlers for turn_end, agent_end, session_start", () => {
    const events = bag.handlers.map(h => h.event);
    expect(events).toContain("turn_end");
    expect(events).toContain("agent_end");
    expect(events).toContain("session_start");
  });

  it("registers get_goal and update_goal tools", () => {
    const names = bag.tools.map(t => t.name);
    expect(names).toContain("get_goal");
    expect(names).toContain("update_goal");
  });

  // -- /goal <empty> (idle) -------------------------------------------------

  it("/goal with empty args when idle shows state via notify", async () => {
    const cmd = bag.commands.find(c => c.name === "goal")!;
    const ctx = buildCtx(bag);
    await cmd.handler("", ctx);
    // idle → shows JSON state
    expect(bag.notifyCalls.length).toBe(1);
    expect(bag.notifyCalls[0].message).toContain('"idle"');
  });

  // -- /goal <objective> ----------------------------------------------------

  it("/goal <objective> starts a goal and sends a continuation message", async () => {
    const cmd = bag.commands.find(c => c.name === "goal")!;
    const ctx = buildCtx(bag);
    await cmd.handler("write unit tests", ctx);

    // Should have sent a continuation message (via setTimeout)
    expect(bag.sendMessageCalls.length).toBe(0); // setTimeout hasn't fired yet
    vi.runAllTimers();
    expect(bag.sendMessageCalls.length).toBe(1);
    const msg = bag.sendMessageCalls[0].message;
    expect(msg.customType).toBe(CUSTOM_TYPE);
    expect(msg.content).toContain("write unit tests");
    expect(bag.sendMessageCalls[0].options.triggerTurn).toBe(true);

    // Should have set the widget
    expect(bag.setWidgetCalls.length).toBe(1);
    expect(bag.setWidgetCalls[0].key).toBe(CUSTOM_TYPE);
    expect(bag.setWidgetCalls[0].content![0]).toContain("write unit tests");

    // Should have added goal tools
    expect(bag.setActiveToolsCalls.length).toBeGreaterThan(0);
    const last = bag.setActiveToolsCalls[bag.setActiveToolsCalls.length - 1];
    expect(last).toContain("get_goal");
    expect(last).toContain("update_goal");
  });

  // -- /goal pause ----------------------------------------------------------

  it("/goal pause pauses the goal and appends state entry", async () => {
    // Start a goal first so we have something to pause
    const cmd = bag.commands.find(c => c.name === "goal")!;
    const ctx = buildCtx(bag);

    // First set the goal
    bag.getEntries = () => [];
    await cmd.handler("some objective", ctx);
    vi.runAllTimers();

    // Now feed the entry so the next GoalStateMachine picks it up
    bag.getEntries = () => [
      entry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "some objective" } }),
    ];

    // Reset bag
    bag.appendEntryCalls = [];
    bag.sendMessageCalls = [];
    bag.setWidgetCalls = [];

    await cmd.handler("pause", ctx);

    expect(bag.appendEntryCalls.length).toBe(1);
    expect(bag.appendEntryCalls[0].customType).toBe(CUSTOM_TYPE);
    expect((bag.appendEntryCalls[0].data as any).phase).toBe("paused");
    expect(bag.setWidgetCalls.length).toBe(1);
    expect(bag.setWidgetCalls[0].content![0]).toContain("some objective");
  });

  // -- /goal resume ---------------------------------------------------------

  it("/goal resume resumes a paused goal and sends continuation", async () => {
    const cmd = bag.commands.find(c => c.name === "goal")!;
    const ctx = buildCtx(bag);

    // Feed state as paused
    bag.getEntries = () => [
      entry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "paused", objective: "paused goal" } }),
    ];

    await cmd.handler("resume", ctx);

    vi.runAllTimers();
    expect(bag.sendMessageCalls.length).toBe(1);
    expect(bag.sendMessageCalls[0].message.content).toContain("paused goal");
    expect(bag.setWidgetCalls.length).toBe(1);
    expect(bag.setWidgetCalls[0].content![0]).toContain("paused goal");
  });

  // -- /goal clear ----------------------------------------------------------

  it("/goal clear clears the goal and appends idle state", async () => {
    const cmd = bag.commands.find(c => c.name === "goal")!;
    const ctx = buildCtx(bag);

    bag.getEntries = () => [
      entry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "to be cleared" } }),
    ];

    await cmd.handler("clear", ctx);

    expect(bag.appendEntryCalls.length).toBe(1);
    expect(bag.appendEntryCalls[0].customType).toBe(CUSTOM_TYPE);
    expect((bag.appendEntryCalls[0].data as any).phase).toBe("idle");
  });

  // -- get_goal tool --------------------------------------------------------

  it("get_goal returns 'No active goal.' when idle", async () => {
    const tool = bag.tools.find(t => t.name === "get_goal")!;
    const ctx = buildCtx(bag);
    const result = await tool.execute("id1", {}, undefined, undefined, ctx);
    expect(result.content[0].text).toBe("No active goal.");
  });

  it("get_goal returns objective and phase when a goal is active", async () => {
    bag.getEntries = () => [
      entry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "build stuff" } }),
    ];
    const tool = bag.tools.find(t => t.name === "get_goal")!;
    const ctx = buildCtx(bag);
    const result = await tool.execute("id1", {}, undefined, undefined, ctx);
    expect(result.content[0].text).toContain("Objective: build stuff");
    expect(result.content[0].text).toContain("Status: ready");
    expect(result.details).toEqual({ objective: "build stuff", phase: "ready" });
  });

  // -- update_goal tool -----------------------------------------------------

  it("update_goal with status 'complete' completes the goal", async () => {
    bag.getEntries = () => [
      entry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "finish me" } }),
    ];
    const tool = bag.tools.find(t => t.name === "update_goal")!;
    const ctx = buildCtx(bag);

    const result = await tool.execute("id1", { status: "complete" }, undefined, undefined, ctx);

    expect(result.content[0].text).toBe("Goal marked complete.");
    // Should have appended idle state
    expect(bag.appendEntryCalls.length).toBe(1);
    expect((bag.appendEntryCalls[0].data as any).phase).toBe("idle");
    // Should have cleared the widget
    expect(bag.setWidgetCalls.length).toBe(1);
    expect(bag.setWidgetCalls[0].content).toBeUndefined();
  });

  it("update_goal throws when not ready", async () => {
    bag.getEntries = () => [];
    const tool = bag.tools.find(t => t.name === "update_goal")!;
    const ctx = buildCtx(bag);
    await expect(
      tool.execute("id1", { status: "complete" }, undefined, undefined, ctx),
    ).rejects.toThrow("Cannot complete goal while not ready");
  });

  // -- session_start event --------------------------------------------------

  it("session_start syncs goal tools based on persisted state", () => {
    const handler = bag.handlers.find(h => h.event === "session_start")!;
    const ctx = buildCtx(bag);

    // When state is idle, goal tools should NOT be active
    bag.activeTools = ["foo"];
    handler.handler({ type: "session_start", reason: "startup" }, ctx);
    expect(bag.setActiveToolsCalls.length).toBe(0);

    // When state is ready, goal tools should be added
    bag.getEntries = () => [
      entry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "ongoing" } }),
    ];
    handler.handler({ type: "session_start", reason: "resume" }, ctx);
    expect(bag.setActiveToolsCalls.length).toBeGreaterThan(0);
    const last = bag.setActiveToolsCalls[bag.setActiveToolsCalls.length - 1];
    expect(last).toContain("get_goal");
    expect(last).toContain("update_goal");
  });

  // -- turn_end event -------------------------------------------------------

  it("turn_end with aborted signal pauses the goal", () => {
    const handler = bag.handlers.find(h => h.event === "turn_end")!;

    bag.getEntries = () => [
      entry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "work" } }),
    ];

    const ctx = buildCtx(bag, { signal: { aborted: true } });
    handler.handler({ type: "turn_end", turnIndex: 1, message: {} as any, toolResults: [] }, ctx);

    // Should have paused the goal
    expect(bag.appendEntryCalls.length).toBe(1);
    expect((bag.appendEntryCalls[0].data as any).phase).toBe("paused");
    // Should have notified
    expect(bag.notifyCalls.length).toBe(1);
    expect(bag.notifyCalls[0].message).toContain("abort signal");
  });

  it("turn_end without aborted signal does nothing", () => {
    const handler = bag.handlers.find(h => h.event === "turn_end")!;
    bag.getEntries = () => [
      entry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "work" } }),
    ];
    const ctx = buildCtx(bag, { signal: undefined });
    handler.handler({ type: "turn_end", turnIndex: 1, message: {} as any, toolResults: [] }, ctx);

    // No calls should have been made
    expect(bag.appendEntryCalls.length).toBe(0);
    expect(bag.notifyCalls.length).toBe(0);
  });

  // -- agent_end event ------------------------------------------------------

  it("agent_end continues when goal is ready and tools were used", async () => {
    const handler = bag.handlers.find(h => h.event === "agent_end")!;

    bag.getEntries = () => [
      entry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "keep going", toolsUsed: 1 } }),
    ];

    const ctx = buildCtx(bag);
    await handler.handler({ type: "agent_end", messages: [] }, ctx);

    vi.runAllTimers();
    expect(bag.sendMessageCalls.length).toBe(1);
    expect(bag.sendMessageCalls[0].message.content).toContain("keep going");
    expect(bag.setWidgetCalls.length).toBe(1);
    expect(bag.setWidgetCalls[0].content![0]).toContain("keep going");
  });

  it("agent_end warns without sending continuation when no tools were used", async () => {
    const handler = bag.handlers.find(h => h.event === "agent_end")!;

    bag.getEntries = () => [
      entry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "no tools used" } }),
    ];

    const ctx = buildCtx(bag);
    await handler.handler({ type: "agent_end", messages: [] }, ctx);

    vi.runAllTimers();
    // Should notify, pause, and not send continuation
    expect(bag.sendMessageCalls.length).toBe(0);
    expect(bag.notifyCalls.length).toBe(1);
    expect(bag.notifyCalls[0].message).toContain("no tool calls");
    expect(bag.appendEntryCalls.length).toBe(1);
    expect((bag.appendEntryCalls[0].data as any).phase).toBe("paused");
  });

  it("agent_end does nothing when goal is idle", async () => {
    const handler = bag.handlers.find(h => h.event === "agent_end")!;
    bag.getEntries = () => [];
    const ctx = buildCtx(bag);
    await handler.handler({ type: "agent_end", messages: [] }, ctx);

    vi.runAllTimers();
    expect(bag.sendMessageCalls.length).toBe(0);
  });

  // -- syncPiState idempotency ----------------------------------------------

  it("syncPiState does not modify tools when already in correct state", () => {
    const handler = bag.handlers.find(h => h.event === "session_start")!;
    bag.activeTools = ["get_goal", "update_goal"];
    bag.setActiveToolsCalls = [];

    bag.getEntries = () => [
      entry({ type: "custom", customType: CUSTOM_TYPE, data: { phase: "ready", objective: "test" } }),
    ];

    handler.handler({ type: "session_start", reason: "startup" }, buildCtx(bag));
    // Tools already present → no change
    expect(bag.setActiveToolsCalls.length).toBe(0);
  });

  it("syncPiState removes goal tools when goal is not ready", () => {
    const handler = bag.handlers.find(h => h.event === "session_start")!;
    bag.activeTools = ["get_goal", "update_goal", "other_tool"];
    bag.setActiveToolsCalls = [];

    bag.getEntries = () => [];
    handler.handler({ type: "session_start", reason: "startup" }, buildCtx(bag));

    expect(bag.setActiveToolsCalls.length).toBe(1);
    expect(bag.setActiveToolsCalls[0]).toEqual(["other_tool"]);
  });
});
