# Behavior contract

## Scope

One user-invoked `/split-fork [optional prompt]` command copies the currently selected Pi conversation branch into one new sibling Herdr pane. No earlier-message selection, worktree creation, task orchestration, remote routing, or automatic result collection is included.

## Requirements and interfaces

- Pi 1.0.3+, Node.js 22.18+, Herdr 0.9.3+, and the Herdr Pi integration.
- `HERDR_ENV=1` and `HERDR_PANE_ID` identify the calling managed pane. Herdr CLI resolves inherited caller context, including moved panes. Commands never use whichever pane happens to have UI focus.
- A saved, nonempty conversation, an idle agent, and no pending messages are required. Concurrent invocations in the same Pi process are rejected during startup.
- Pi's `SessionManager.open()` and `createBranchedSession()` create the copy through a separate manager. The caller's leaf, runtime, and source file are not modified. This preserves the selected branch even if the last persisted entry belongs to an abandoned branch.
- Herdr CLI supplies pane identity, layout geometry, agent names, startup readiness, pane labels, and prompt submission. JSON replies are validated at these boundaries. Native Pi arguments are passed separately after Herdr's `--` delimiter, not interpolated into a shell command.

## Invariants

- The new pane has the same workspace and tab as the caller, a different pane ID, the current working directory, and no focus request.
- Wide means pane width is at least twice its height in terminal cells. Wide panes split right; other panes split down. There are no direction or worktree options in this version.
- The agent name starts with `session-fork` and remains unique among live agents. The pane label and Pi session display name match it. Private prompt text and repository paths are not used as labels.
- Current model and thinking level are captured before launch. Other configuration and permissions load normally in the child; arbitrary parent CLI overrides and in-memory extension state are not copied.
- The native process opens the new session file with `--session`, never the caller's file. CLI `--fork` is not used because it copies the entire file and can resume a different leaf.
- An optional prompt is submitted once only after Herdr startup and labeling succeed. Without a prompt, the child stays interactive and idle. Submission is not proof of execution or completion.

## Permissions and data handling

The command runs local Herdr CLI commands, writes one Pi session copy, and starts one local Pi process. It requires the same OS permissions as Pi and access to the Herdr socket. It is not a permission sandbox. Parent and child share filesystem access and may conflict if editing the same files.

Conversation history can include private prompts and tool output. It stays in Pi's session storage and is not published by this extension. This package registers no network service, telemetry, or provider call. An optional prompt can start ordinary agent work using the child's configured provider and permissions.

Existing conversation-level custom entries are preserved by Pi's branch API. Extension-specific behavior in the child is owned by those extensions, not translated or removed here.

## Failure behavior

Preflight failures create no pane. If a fork file is created before a subsequent failure, it is retained and reported. A failed split can have an uncertain outcome; inspect the caller's tab before repeating it.

Once a pane ID is known, subsequent failures identify it and leave the pane and any running process intact. Startup, labeling, and prompt failures never trigger automatic retries, prompt re-sends, or pane closure. A name collision during startup fails rather than retrying an uncertain agent start. Correct it manually after inspecting the pane.

CLI invocations have a bounded timeout. A timeout does not prove that no side effect occurred. JSON parsing errors and protocol mismatches are surfaced as errors, not treated as success. The command reports these failures through Pi notifications.

## Acceptance and verification

Focused automated proof covers selected-branch preservation using real Pi session files, unchanged parent state, explicit sibling routing and focus preservation, unique portable launch names, argument boundaries, exactly one optional prompt, and retained panes/no retries on uncertain failures. Types enforce the host API contract; tests do not duplicate type checks or snapshot rendered output.

Live acceptance checks an idle Pi fork in Herdr with a distinct session ID and source parent reference, matching workspace/tab/cwd/model/thinking, matching labels, and preserved caller focus. Startup session metadata can arrive after screen-based interactive readiness; allow a bounded interval when inspecting that receipt. Agent tasks, model answers, and filesystem isolation are not part of this proof.

CI covers Node.js 22 and 24 on Linux and macOS. Windows is not claimed as verified. No fallback implementation for older Pi or Herdr APIs is included.
