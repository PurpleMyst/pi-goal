import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

import { GoalManager, CUSTOM_TYPE } from "./goal_manager";

const GOAL_TOOLS = ["get_goal", "update_goal"];

function syncGoalTools(pi: ExtensionAPI, gm: GoalManager) {
  const active = pi.getActiveTools();
  const shouldHave = gm.state.phase === "ready";
  const has = GOAL_TOOLS.every(n => active.includes(n));
  if (shouldHave === has) return;
  pi.setActiveTools(
    shouldHave
      ? [...active, ...GOAL_TOOLS]
      : active.filter(n => !GOAL_TOOLS.includes(n))
  );
}

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
      } else {
        prompt = gm.start(args);
      }
      syncGoalTools(pi, gm);
      if (prompt !== undefined) sendGoalMessage(pi, prompt, gm);
      else pi.appendEntry(CUSTOM_TYPE, gm.state);
      if (ctx.hasUI) ctx.ui.setWidget(CUSTOM_TYPE, gm.status());
    },
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
      syncGoalTools(pi, gm);
      return;
    }
  });

  pi.on("agent_end", async (_, ctx) => {
    const gm = new GoalManager(ctx.sessionManager);
    const prompt = gm.continue();
    if (prompt === undefined) return;
    sendGoalMessage(pi, prompt, gm);
    if (ctx.hasUI) ctx.ui.setWidget(CUSTOM_TYPE, gm.status());
  });

  pi.on("session_start", (_, ctx) => {
    const gm = new GoalManager(ctx.sessionManager);
    syncGoalTools(pi, gm);
  });

  pi.registerTool({
    name: "get_goal",
    label: "Get Current Goal",
    description:
      "Get the current active goal objective and status. Returns 'No active goal.' if none is set.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const gm = new GoalManager(ctx.sessionManager);
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
      const gm = new GoalManager(ctx.sessionManager);
      gm.complete();
      syncGoalTools(pi, gm);
      if (ctx.hasUI) ctx.ui.setWidget(CUSTOM_TYPE, undefined);
      pi.appendEntry(CUSTOM_TYPE, gm.state);
      return {
        content: [{ type: "text", text: "Goal marked complete." }],
        details: {}
      };
    },
  });
}

function sendGoalMessage(pi: ExtensionAPI, prompt: string, gm: GoalManager) {
  // HACK: Use setTimeout to ensure this runs after the current turn's processing is fully complete,
  // allowing the message to be properly associated with the next turn.
  // Not documented behavior, but what works works. ¯\_(ツ)_/¯
  setTimeout(() => {
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
  }, 0);
}
