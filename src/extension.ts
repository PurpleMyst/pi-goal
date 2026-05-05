import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

import { GoalManager, CUSTOM_TYPE, NO_TOOL_CALLS } from "./goal_manager";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("goal", {
    description: "Give the agent a goal.",
    async handler(args, ctx) {
      let prompt: string | undefined;
      const gm = new GoalManager(ctx.sessionManager);
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
      if (ctx.hasUI) ctx.ui.setWidget(CUSTOM_TYPE, gm.status());
    },
  });

  pi.on("session_start", async (_, ctx) => {
    const gm = new GoalManager(ctx.sessionManager);
    syncPiState(pi, ctx, gm);
  });

  pi.on("tool_call", async (_, ctx) => {
    const gm = new GoalManager(ctx.sessionManager);
    gm.registerToolCall();
  });

  // Docs specify `ctx.signal.aborted` is set only in turn-related events, not in session-related
  // events, so we check here.
  pi.on("turn_end", async (_, ctx) => {
    if (ctx.signal?.aborted) {
      const gm = new GoalManager(ctx.sessionManager);
      if (gm.state.phase !== "ready") return;
      ctx.ui.notify("Agent ended due to abort signal; not sending continuation prompt.", "warning");
      gm.pause();
      pi.appendEntry(CUSTOM_TYPE, gm.state);
      syncPiState(pi, ctx, gm);
      return;
    }
  });

  pi.on("agent_end", async (_, ctx) => {
    const gm = new GoalManager(ctx.sessionManager);
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
    name: "update_goal",
    label: "Update Goal Status",
    description:
      'Update the status of the current goal. Call with status "complete" when the goal is achieved.',
    parameters: Type.Object({
      status: Type.Literal("complete"),
    }),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const gm = new GoalManager(ctx.sessionManager);
      gm.complete();
      pi.appendEntry(CUSTOM_TYPE, gm.state);
      syncPiState(pi, ctx, gm);
      return {
        content: [{ type: "text", text: "Goal marked complete." }],
        details: {},
        terminate: true,
      };
    },
  });
}

/// Sync the active state of the "update_goal" tool based on the current goal state, and update the UI widget.
function syncPiState(pi: ExtensionAPI, ctx: ExtensionContext, gm: GoalManager) {
  const activeTools = pi.getActiveTools();
  const isActive = activeTools.includes("update_goal");
  if (gm.state.phase === "ready") {
    if (!isActive) pi.setActiveTools([...activeTools, "update_goal"]);
  } else if (isActive) {
    pi.setActiveTools(activeTools.filter((name) => name !== "update_goal"));
  }
  if (ctx.hasUI) ctx.ui.setWidget(CUSTOM_TYPE, undefined);
}

/// Send a message with the given prompt and the current goal state as details.
/// If there are pending messages or the context is not idle, we pause the goal manager and send the message as an entry instead.
//  This also calls syncPiState.
function sendGoalMessage(pi: ExtensionAPI, ctx: ExtensionContext, prompt: string, gm: GoalManager) {
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
