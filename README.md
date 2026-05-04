# pi-goal

`pi-goal` is an extension for the [pi coding agent](https://pi.dev).

## Installation

To install `pi-goal`, run the following command:

```bash
pi install git:github.com/PurpleMyst/pi-goal
```

## Usage

- Run `/goal <GOAL>` to set a goal for the agent. This is session-scoped; it is saved inside the
  regular session jsonlines files, and will be loaded when the session is loaded.
- Run `/goal pause` to pause the agent; it will still allow the current turn to end, but there will
  be no new turns until the goal is resumed.
- Aborting the agent will set the goal to "paused". This is useful if you want to take a break and come back to the same goal later.
- Run `/goal resume` to resume the last goal. This is useful if you want to continue working on a goal after a break.
- Run `/goal clear` to clear the goal.
- Run `/goal` to show the current goal.

## Credits

- [Codex](https://github.com/openai/codex) for the original implementation.
- Geoffrey Huntley's [Ralph Wiggum](https://ghuntley.com/ralph/) for the general pattern.
- [`@tmustier/pi-ralph-wiggum`](https://github.com/tmustier/pi-extensions/tree/main/pi-ralph-wiggum) for a prior Pi implementation of that idea.

## Historical note

This is a ground-up rewrite of the v1.0.0 of this extension with a new hand-written approach: rather
than persisting to a JSON file within the current working directory, the mechanisms that Pi exposes
to write to the session file are used. This, at least for the current MVP as for the time of
writing, means the code is greatly simplified; I'd also gotten myself into a bind with the previous
version's slop pseudo-effect system, so when I got the idea to rewrite it, I went for a much more
straightforward approach.
