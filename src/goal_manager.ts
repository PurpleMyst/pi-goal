import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

import { continuationPrompt } from "./prompts";

export const CUSTOM_TYPE = "pi-goal";

// export type GoalState =
//   | { phase: "idle" }
//   | { phase: "ready", objective: string }
//   ;
export const GoalStateSchema = Type.Union([
  Type.Object({ phase: Type.Literal("idle") }),
  Type.Object({ phase: Type.Literal("ready"), objective: Type.String() }),
  Type.Object({ phase: Type.Literal("paused"), objective: Type.String() }),
]);
export type GoalState = Static<typeof GoalStateSchema>;

export class GoalManager {
  state: GoalState;

  constructor(sm: { getEntries(): SessionEntry[] }) {
    const entries = sm.getEntries();
    entries.reverse();
    for (const entry of entries) {
      if ((entry.type === "custom_message" || entry.type === "custom") && entry.customType === CUSTOM_TYPE) {
        // XXX: ↓ Weird type error here ¯\_(ツ)_/¯
        this.state = Value.Parse(GoalStateSchema, entry.type === "custom_message" ? entry.details : entry.data);
        return;
      }
    }
    this.state = { phase: "idle" };
  }

  /// Get the current status of the goal manager, fit for widget display.
  status(): string[] | undefined {
    if (this.state.phase === "idle") return undefined;
    if (this.state.phase === "ready") return [`🥅 Objective: ${this.state.objective.substring(0, 30)}${this.state.objective.length > 30 ? "..." : ""}`];
    if (this.state.phase === "paused") return [`⏸️ Paused objective: ${this.state.objective.substring(0, 30)}${this.state.objective.length > 30 ? "..." : ""}`];
    return ["🥅 Unknown state"];
  }

  /// Start a new goal with the given objective. The manager must be idle; if this does not throw, 
  start(
    objective: string,
  ) {
    if (this.state.phase !== "idle") throw new Error("Cannot set objective while not idle");
    this.state = { phase: "ready", objective };
    return this.continue();
  }

  resume(): string {
    if (this.state.phase !== "paused") throw new Error("Cannot resume goal while not paused");
    this.state = { phase: "ready", objective: this.state.objective };
    const prompt = this.continue();
    return prompt!;
  }

  continue(): string | undefined {
    if (this.state.phase !== "ready") return;
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
}
