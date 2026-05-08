import type { Theme } from "@mariozechner/pi-coding-agent";

import { continuationPrompt } from "./prompts";
import goal_widget from "./goal_widget";
import { GoalState } from "./goal_state";

export const NO_TOOL_CALLS = Symbol("NO_TOOL_CALLS");

export class GoalStateMachine {
  constructor(public state: GoalState) {}

  /** Get the current status of the goal manager, fit for widget display. */
  status(theme: Theme): string[] | undefined {
    if (this.state.phase === "idle") return undefined;
    return goal_widget(theme, this.state);
  }

  /** Start a new goal with the given objective. The manager must be idle; if this does not throw,
   * the returned string should be sent as a message to the agent. If the manager is paused, the
   * confirmIfPaused callback will be called, and the goal will only be started if it returns true.
   */
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
    this.state = { phase: "ready", objective, startedAt: Date.now() };
    return continuationPrompt(objective);
  }

  resume(): string {
    if (this.state.phase !== "paused") throw new Error("Cannot resume goal while not paused");
    this.state = { phase: "ready", objective: this.state.objective, startedAt: Date.now() };
    return continuationPrompt(this.state.objective);
  }

  continue(): string | typeof NO_TOOL_CALLS | undefined {
    if (this.state.phase !== "ready") return;
    if (!this.state.toolsUsed) return NO_TOOL_CALLS;
    return continuationPrompt(this.state.objective);
  }

  /** Abort the current goal, if any, and pause it. Returns true if a goal was paused, false if
   * there was no goal to pause. */
  abort(): boolean {
    if (this.state.phase !== "ready") return false;
    this.pause();
    return true;
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

  registerToolCall(): boolean {
    if (this.state.phase !== "ready") return false;
    this.state.toolsUsed = (this.state.toolsUsed ?? 0) + 1;
    return true;
  }
}
