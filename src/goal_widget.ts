import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";

import type { GoalState } from "./goal_state";

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

export default function (theme: Theme, state: GoalState): string[] {
  const maxObjLen = 30;

  if (state.phase === "ready") {
    const elapsedMs = Date.now() - (state.startedAt ?? Date.now());
    const elapsedStr = formatDuration(elapsedMs);
    const toolStr = `· ${state.toolsUsed ?? 0} tools`;
    const prefix = " " + theme.fg("accent", "Goal: ");
    const suffix = ` · ${elapsedStr} ${toolStr}`;
    const obj = truncateToWidth(state.objective, maxObjLen, "…");
    const line = prefix + obj + suffix;
    return [line];
  }

  if (state.phase === "paused") {
    const prefix = "  " + theme.fg("warning", "Goal: ");
    const obj = truncateToWidth(state.objective, maxObjLen, "…");
    const line = prefix + obj;
    return [line];
  }

  return ["🥅 Unknown state"];
}
