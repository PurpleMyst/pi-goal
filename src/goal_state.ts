import { Type, type Static } from "typebox";

export const GoalStateSchema = Type.Union([
  Type.Object({ phase: Type.Literal("idle") }),
  Type.Object({
    phase: Type.Literal("ready"),
    objective: Type.String(),
    toolsUsed: Type.Optional(Type.Number()),
    startedAt: Type.Optional(Type.Number()),
  }),
  Type.Object({ phase: Type.Literal("paused"), objective: Type.String() }),
  Type.Object({
    phase: Type.Literal("blocked"),
    objective: Type.String(),
    blocker: Type.Optional(Type.String()),
  }),
]);
export type GoalState = Static<typeof GoalStateSchema>;
