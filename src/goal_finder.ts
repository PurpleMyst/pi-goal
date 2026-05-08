import type { SessionManager } from "@mariozechner/pi-coding-agent";
import { GoalState, GoalStateSchema } from "./goal_state";

import { Value } from "typebox/value";

export const CUSTOM_TYPE = "pi-goal";

/** Find the most recent goal state in the session entries, and return it. If none is found, returns an idle state. */
export function goalForSession(sm: Pick<SessionManager, "getEntries">): GoalState {
  const entries = sm.getEntries();
  entries.reverse();
  for (const entry of entries) {
    if (
      (entry.type === "custom_message" || entry.type === "custom") &&
      entry.customType === CUSTOM_TYPE
    ) {
      return Value.Parse(
        GoalStateSchema,
        entry.type === "custom_message" ? entry.details : entry.data,
      );
    }
  }
  return { phase: "idle" };
}
