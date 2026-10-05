# pi-herdr-split-fork

Copy your current [Pi](https://pi.dev) conversation into a sibling [Herdr](https://herdr.dev) pane. Keep working in the original while exploring another approach next to it.

```text
/split-fork
/split-fork Explore an alternative approach without changing files
```

The new pane stays in the same workspace and tab. It gets the currently selected conversation branch, working directory, model, and thinking level. Focus stays on the original pane.

**Both sessions share files.** This copies conversation history, not your filesystem. It does not create a Git worktree or undo edits. Avoid simultaneous edits to the same files.

## Install

Requirements:

- Pi 1.0.3 or newer, running inside Herdr.
- Herdr 0.9.3 or newer with the Pi integration installed.
- Node.js 22.18 or newer, and `herdr` and `pi` available on `PATH`.

```bash
herdr integration install pi
pi install git:github.com/felores/pi-herdr-split-fork
```

Run `/reload` in existing Pi sessions. Then use `/split-fork` after the current turn and queued messages finish.

No npm publication, Python, personal scripts, or custom machine paths are required.

### If you already use agent-stuff

Disable `mitsuhiko/agent-stuff`'s `extensions/split-fork.ts` with `pi config` before enabling this package. Both register `/split-fork`; keep only one enabled. The agent-stuff version targets Ghostty, while this one targets Herdr.

## What happens

1. Pi saves a copy of the selected conversation branch into a new session file.
2. Herdr splits the calling pane right if it is wide, or down if it is narrow or tall.
3. A new Pi process opens the copy in the same directory, with the current model and thinking level.
4. The agent and pane receive the same unique `session-fork` name, with a numeric suffix if needed.
5. With a prompt, the command submits it after successful startup and labeling. Without a prompt, the new session waits for your input.

Prompt submission is not proof of task completion. This extension does not assign a managed task or subscribe to results.

## Fork, clone, or split-fork?

- **`/fork`** selects an earlier user message, creates a separate session immediately before it, and puts that message back in the editor for revision. It switches the current pane to the new session.
- **`/clone`** copies the current branch through its endpoint and switches the current pane to the copy.
- **`/split-fork`** copies the current branch through its endpoint into a new sibling Herdr pane, leaving the original session open. There is no message selector.

This is closer to a split-clone than an earlier-message fork. It is inspired by agent-stuff's split-fork command, but uses Herdr and Pi's public session API rather than copying session JSON by hand.

## Failure recovery

Outside Herdr, with an unsaved/empty session, or while the agent is busy, the command creates nothing.

If startup, labeling, or prompt submission fails after a split, the new pane and fork file are retained. The error identifies them when available. Inspect them before retrying. A startup error can mean Pi is already running or waiting for approval.

The command never silently retries, closes a potentially useful pane, or sends a prompt twice. It does not fall back to Ghostty or open a new workspace/tab.

See [the behavior contract](docs/behavior.md) for permissions, edge cases, and verification details.

## Development

```bash
npm ci
npm run check
```

The tests exercise the registered command against real Pi session files and a simulated Herdr boundary. They do not launch agents or call model providers. CI runs them on Linux and macOS with Node.js 22 and 24.

Manual acceptance: in an idle Herdr Pi session, run `/split-fork` and verify a new sibling pane with a distinct session, matching agent/pane labels, preserved selected context, directory, model and thinking, and unchanged focus. Close only the pane created for your check.

MIT licensed.
