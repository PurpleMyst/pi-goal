import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

import { GoalStateMachine, NO_TOOL_CALLS } from "./goal_state_machine";
import { CUSTOM_TYPE, goalForSession } from "./goal_finder";

const GOAL_TOOLS = ["get_goal", "update_goal"];

export default function (pi: ExtensionAPI) {
  pi.registerCommand("goal", {
    description: "Give the agent a goal.",
    async handler(args, ctx) {
      let prompt: string | undefined;
      const gm = new GoalStateMachine(goalForSession(ctx.sessionManager));
      if (args.trim().length === 0) {
        ctx.ui.notify(JSON.stringify(gm.state));
        return;
      } else if (args.trim().toLowerCase() === "pause") {
        gm.pause();
      } else if (args.trim().toLowerCase() === "resume") {
        prompt = gm.resume();
      } else if (args.trim().toLowerCase() === "clear") {
        gm.clear();
        ctx.ui.notify("Goal cleared.");
      } else {
        prompt = await gm.start(
          args,
          ctx.hasUI
            ? () => ctx.ui.confirm("A goal is already active.", "Do you want to override it?")
            : () => false,
        );
      }
      if (prompt !== undefined) sendGoalMessage(pi, ctx, prompt, gm);
      else {
        pi.appendEntry(CUSTOM_TYPE, gm.state);
        syncPiState(pi, ctx, gm);
      }
    },
  });

  pi.on("session_start", async (_, ctx) => {
    const gm = new GoalStateMachine(goalForSession(ctx.sessionManager));
    syncPiState(pi, ctx, gm);
  });

  pi.on("tool_call", async (_, ctx) => {
    const gm = new GoalStateMachine(goalForSession(ctx.sessionManager));
    if (gm.registerToolCall()) {
      pi.appendEntry(CUSTOM_TYPE, gm.state);
      syncPiState(pi, ctx, gm);
    }
  });

  // Docs specify `ctx.signal.aborted` is set only in turn-related events, not in session-related
  // events, so we check here.
  pi.on("turn_end", async (_, ctx) => {
    if (ctx.signal?.aborted) {
      const gm = new GoalStateMachine(goalForSession(ctx.sessionManager));
      if (gm.state.phase !== "ready") return;
      ctx.ui.notify("Agent ended due to abort signal; not sending continuation prompt.", "warning");
      gm.pause();
      pi.appendEntry(CUSTOM_TYPE, gm.state);
      syncPiState(pi, ctx, gm);
      return;
    }
  });

  pi.on("agent_end", async (_, ctx) => {
    const gm = new GoalStateMachine(goalForSession(ctx.sessionManager));
    const prompt = gm.continue();
    if (prompt === undefined) return;
    if (prompt === NO_TOOL_CALLS) {
      ctx.ui.notify("Previous iteration made no tool calls. Pausing for safety.", "warning");
      // XXX: ↓ We always call these two as a pair, maybe a little two-line function might be nice to have?
      pi.appendEntry(CUSTOM_TYPE, gm.state);
      syncPiState(pi, ctx, gm);
    } else {
      sendGoalMessage(pi, ctx, prompt, gm);
    }
  });

  pi.registerTool({
    name: "get_goal",
    label: "Get Current Goal",
    description:
      "Get the current active goal objective and status. Returns 'No active goal.' if none is set.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const gm = new GoalStateMachine(goalForSession(ctx.sessionManager));
      if (gm.state.phase === "idle") {
        return { content: [{ type: "text", text: "No active goal." }], details: {} };
      }
      return {
        content: [
          {
            type: "text",
            text: `Objective: ${gm.state.objective}\nStatus: ${gm.state.phase}`,
          },
        ],
        details: { objective: gm.state.objective, phase: gm.state.phase },
      };
    },
  });

  pi.registerTool({
    name: "update_goal",
    label: "Update Goal Status",
    description:
      'Update the status of the current goal. Call with status "complete" when the goal is achieved. Do not mark a goal complete merely because you are stopping work or the budget is running out — only mark it complete when the objective has actually been achieved and no required work remains.',
    parameters: Type.Object({
      status: Type.Literal("complete"),
    }),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const gm = new GoalStateMachine(goalForSession(ctx.sessionManager));
      gm.complete();
      pi.appendEntry(CUSTOM_TYPE, gm.state);
      syncPiState(pi, ctx, gm);
      return {
        content: [{ type: "text", text: "Goal marked complete." }],
        details: {}
      };
    },
  });
}

/** Sync the active state of goal tools based on the current goal state, and update the UI widget. */
function syncPiState(pi: ExtensionAPI, ctx: ExtensionContext, gm: GoalStateMachine) {
  const activeTools = pi.getActiveTools();
  if (gm.state.phase === "ready") {
    const missing = GOAL_TOOLS.filter((name) => !activeTools.includes(name));
    if (missing.length > 0) pi.setActiveTools([...activeTools, ...missing]);
  } else {
    const toRemove = activeTools.filter((name) => GOAL_TOOLS.includes(name));
    if (toRemove.length > 0) pi.setActiveTools(activeTools.filter((name) => !GOAL_TOOLS.includes(name)));
  }
  if (ctx.hasUI)
    ctx.ui.setWidget(CUSTOM_TYPE, gm.state.phase === "idle" ? undefined : gm.status(ctx.ui.theme));
}

/**
 * Send a message with the given prompt and the current goal state as details.
 * If there are pending messages or the context is not idle, we pause the goal manager and send the message as an entry instead.
 */
//  This also calls syncPiState.
function sendGoalMessage(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  prompt: string,
  gm: GoalStateMachine,
) {
  gm.resetToolCalls();
  syncPiState(pi, ctx, gm);

  // HACK: Use setTimeout to ensure this runs after the current turn's processing is fully complete,
  // allowing the message to be properly associated with the next turn.
  // Not documented behavior, but what works works. ¯\_(ツ)_/¯
  setTimeout(() => {
    if (ctx.hasPendingMessages() || !ctx.isIdle()) {
      gm.pause();
      syncPiState(pi, ctx, gm);
      pi.appendEntry(CUSTOM_TYPE, gm.state);
    } else {
      pi.sendMessage(
        {
          customType: CUSTOM_TYPE,
          content: prompt,
          display: true,
          details: gm.state,
        },
        {
          triggerTurn: true,
        },
      );
    }
  }, 0);
}
