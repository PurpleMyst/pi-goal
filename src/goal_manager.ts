// XXX: ↓ This is the only thing that's bleeding in from pi in this file... might think of splitting
// into state machine + a factory function for getting from session entries?
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

import { continuationPrompt } from "./prompts";

export const CUSTOM_TYPE = "pi-goal";

export const NO_TOOL_CALLS = Symbol("NO_TOOL_CALLS");

// export type GoalState =
//   | { phase: "idle" }
//   | { phase: "ready", objective: string }
//   ;
export const GoalStateSchema = Type.Union([
  Type.Object({ phase: Type.Literal("idle") }),
  Type.Object({
    phase: Type.Literal("ready"),
    objective: Type.String(),
    toolsUsed: Type.Optional(Type.Number()),
  }),
  Type.Object({ phase: Type.Literal("paused"), objective: Type.String() }),
]);
export type GoalState = Static<typeof GoalStateSchema>;

export class GoalManager {
  state: GoalState;

  constructor(sm: { getEntries(): SessionEntry[] }) {
    const entries = sm.getEntries();
    entries.reverse();
    for (const entry of entries) {
      if (
        (entry.type === "custom_message" || entry.type === "custom") &&
        entry.customType === CUSTOM_TYPE
      ) {
        // XXX: ↓ Weird type error here ¯\_(ツ)_/¯
        this.state = Value.Parse(
          GoalStateSchema,
          entry.type === "custom_message" ? entry.details : entry.data,
        );
        return;
      }
    }
    this.state = { phase: "idle" };
  }

  /// Get the current status of the goal manager, fit for widget display.
  status(): string[] | undefined {
    if (this.state.phase === "idle") return undefined;
    if (this.state.phase === "ready")
      return [
        `🥅 Objective: ${this.state.objective.substring(0, 30)}${this.state.objective.length > 30 ? "..." : ""}`,
      ];
    if (this.state.phase === "paused")
      return [
        `⏸️ Paused objective: ${this.state.objective.substring(0, 30)}${this.state.objective.length > 30 ? "..." : ""}`,
      ];
    return ["🥅 Unknown state"];
  }

  /// Start a new goal with the given objective. The manager must be idle; if this does not throw,
  async start(
    objective: string,
    confirmIfPaused: () => Promise<boolean> | boolean,
  ): Promise<string> {
    if (this.state.phase !== "idle") {
      if (this.state.phase === "paused" && (await confirmIfPaused())) {
      } else {
        throw new Error("Cannot set objective while not idle");
      }
    }
    this.state = { phase: "ready", objective };
    return continuationPrompt(objective);
  }

  resume(): string {
    if (this.state.phase !== "paused") throw new Error("Cannot resume goal while not paused");
    this.state = { phase: "ready", objective: this.state.objective };
    return continuationPrompt(this.state.objective);
  }

  continue(): string | typeof NO_TOOL_CALLS | undefined {
    if (this.state.phase !== "ready") return;
    if (!this.state.toolsUsed) return NO_TOOL_CALLS;
    return continuationPrompt(this.state.objective);
  }

  pause() {
    if (this.state.phase !== "ready") throw new Error("Cannot pause goal while not ready");
    this.state = { phase: "paused", objective: this.state.objective };
  }

  complete() {
    if (this.state.phase !== "ready") throw new Error("Cannot complete goal while not ready");
    this.clear();
  }

  clear() {
    this.state = { phase: "idle" };
  }

  resetToolCalls() {
    if (this.state.phase !== "ready") return;
    this.state.toolsUsed = 0;
  }

  registerToolCall() {
    if (this.state.phase !== "ready") return;
    this.state.toolsUsed = (this.state.toolsUsed ?? 0) + 1;
  }
}
