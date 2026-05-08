import type { GoalState } from "./goal_manager";

export function goalWidget(state: GoalState): string[] | undefined {
  if (state.phase === "idle") return undefined;
  if (state.phase === "ready")
    return [
      `🥅 Objective: ${state.objective.substring(0, 30)}${state.objective.length > 30 ? "..." : ""}`,
    ];
  if (state.phase === "paused")
    return [
      `⏸️ Paused objective: ${state.objective.substring(0, 30)}${state.objective.length > 30 ? "..." : ""}`,
    ];
  return ["🥅 Unknown state"];
}
