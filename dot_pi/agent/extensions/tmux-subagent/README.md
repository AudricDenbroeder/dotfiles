# tmux-subagent Extension

Spawn and orchestrate sub-agents as full interactive `pi` TUI instances in dedicated tmux panes, with **bidirectional communication** via an asymmetric channel: direct input injection for parent→sub, and file-based mailbox for sub→parent replies.

## Features

- **Full TUI sub-agents**: Each spawned sub-agent runs `pi` as an interactive, full-featured terminal UI (not headless JSON mode)
- **Asymmetric communication**: 
  - Parent → sub: Direct `tmux send-keys` injection into the sub-agent's prompt
  - Sub → parent: File mailbox with `out.txt` (reply body) + `out.done` (completion signal)
- **Pane lifecycle**: `spawn` (create), `send` (message), `read` (await reply), `list` (enumerate), `kill` (cleanup)
- **Human visibility**: Each pane is titled with the sub-agent name for easy tracking in tmux status bar
- **Single-call read**: The `read` action polls internally with backoff + timeout; no extra parent LLM turns spent waiting
- **Stateful registry**: In-memory map of active sub-agent panes (name → paneId + mailbox directory)

## Installation

### Global (User-level)

Install globally so `/reload` in any `pi` session can load the extension:

```bash
# Create the extension directory
mkdir -p ~/.pi/agent/extensions/tmux-subagent

# Symlink the extension files
ln -sf "$(pwd)/extensions/tmux-subagent/index.ts" ~/.pi/agent/extensions/tmux-subagent/index.ts
ln -sf "$(pwd)/extensions/tmux-subagent/tmux.ts" ~/.pi/agent/extensions/tmux-subagent/tmux.ts
ln -sf "$(pwd)/extensions/tmux-subagent/registry.ts" ~/.pi/agent/extensions/tmux-subagent/registry.ts
ln -sf "$(pwd)/extensions/tmux-subagent/prompt.ts" ~/.pi/agent/extensions/tmux-subagent/prompt.ts
ln -sf "$(pwd)/extensions/tmux-subagent/polling.ts" ~/.pi/agent/extensions/tmux-subagent/polling.ts
```

Then in any `pi` session, run `/reload` to hot-load the extension.

### Project-local

For development or repo-specific use, install in the project's `.pi/` directory:

```bash
mkdir -p .pi/extensions/tmux-subagent
ln -sf "$(pwd)/extensions/tmux-subagent/index.ts" .pi/extensions/tmux-subagent/index.ts
ln -sf "$(pwd)/extensions/tmux-subagent/tmux.ts" .pi/extensions/tmux-subagent/tmux.ts
ln -sf "$(pwd)/extensions/tmux-subagent/registry.ts" .pi/extensions/tmux-subagent/registry.ts
ln -sf "$(pwd)/extensions/tmux-subagent/prompt.ts" .pi/extensions/tmux-subagent/prompt.ts
ln -sf "$(pwd)/extensions/tmux-subagent/polling.ts" .pi/extensions/tmux-subagent/polling.ts
```

## Requirements

- **tmux** 3.0+ (must be installed and available in `PATH`)
- Running inside a tmux session (check `$TMUX` environment variable)
- Node.js 18+ (to run `pi`)

## Usage

The extension provides a single tool, `tmux_agent`, with an `action` parameter. Below are examples for each action.

### spawn — Create a sub-agent pane

Spawns a new tmux pane running an interactive `pi` TUI instance, assigned a unique name.

**Parameters:**
- `name` (string, required): Unique identifier for the sub-agent (used in pane title and mailbox path)
- `direction` (string, optional): `"vertical"` or `"horizontal"`. Default: `"vertical"`
- `size` (number, optional): Pane size in lines/columns (depends on direction). Default: 50% of current
- `role` (string, optional): `"planner"` | `"scout"` | `"coder"` | `"reviewer"`. Assigns the sub-agent a specialized purpose (see [Roles](#roles) below). Omit for a generic sub-agent (today's default behavior).

**Example:**

```
Spawn a new sub-agent named "research" in a vertical split
```

**Response:**
```
Spawned sub-agent "research" in pane abc123
Mailbox: /tmp/pi-mailbox/research
```

The new pane's title is set to `"research"` (visible in tmux status bar). The sub-agent's TUI is ready for input.

---

### send — Send a message to a sub-agent

Injects a message into the sub-agent's `pi` prompt using `tmux send-keys`, then submits it with `Enter`.

**Parameters:**
- `name` (string, required): Name of the target sub-agent
- `text` (string, required): Message to send (supports multi-line)

**Example:**

```
Send "ping" to the "research" sub-agent
```

**Response:**
```
Sent to "research": "ping"
```

The message appears as user input in the sub-agent's TUI, and the Enter key is automatically pressed. The sub-agent processes it normally.

---

### read — Wait for and retrieve a sub-agent's reply

Polls for the completion marker (`out.done`) in the mailbox directory, with exponential backoff (300ms → 2s cap). Once the marker appears, reads `out.txt`, cleans up both files, and returns the reply text.

**Parameters:**
- `name` (string, required): Name of the target sub-agent
- `timeout` (number, optional): Max wait time in milliseconds. Default: 60000 (60 seconds)

**Example:**

```
Read the reply from "research" (waiting up to 60 seconds)
```

**Response (success):**
```
Reply from "research":
Here is the result you requested...
```

**Response (timeout):**
```
Timeout: No reply from "research" after 60000ms
(Mailbox files left intact for debugging)
```

The entire poll loop runs inside this single tool call—no extra parent LLM turns are spent waiting. If the timeout is exceeded, both `out.txt` and `out.done` are left in the mailbox for debugging; otherwise, they are cleaned up.

---

### list — Enumerate active sub-agent panes

Displays all currently tracked sub-agent panes with their status (alive or dead) and pane IDs.

**Parameters:** None

**Example:**

```
List all active sub-agents
```

**Response:**
```
Active sub-agents:
  research (alive, pane abc123)
  debug (dead, pane def456)
```

Panes marked "dead" have exited or been killed but are still tracked in the registry. Calling `kill` on a dead pane is safe (idempotent).

---

### kill — Terminate a sub-agent pane

Kills the pane via tmux and removes it from the registry.

**Parameters:**
- `name` (string, required): Name of the sub-agent to kill

**Example:**

```
Kill the "research" sub-agent
```

**Response:**
```
Killed sub-agent "research"
```

If the pane is already dead or not found, the action completes successfully without error (idempotent).

---

## Roles

When spawning, you may optionally pass a `role` to give the sub-agent a specialized system-prompt addendum. Each role has:

- A **description**, surfaced to the *parent* agent (in the tool description and in `list` output) so it knows what each role is for and when to use it.
- A **prompt** addendum, appended to the sub-agent's own system prompt (after the mailbox protocol instructions, which are always included regardless of role).

| Role | Description |
|------|--------------|
| `planner` | Breaks down a goal into a concrete plan/task list. Use when you need upfront decomposition or sequencing before work starts. |
| `scout` | Explores/investigates the codebase or environment and reports findings without making changes. Use for research, reconnaissance, or gathering context. |
| `coder` | Implements a well-defined piece of work (writes/edits code). Use once a task is clear and ready to be executed. |
| `reviewer` | Reviews completed work (code, plans, output) for correctness, quality, and risks. Use after a coder/planner has produced something that needs checking. |

Role definitions live in `roles.ts` as a `Record<Role, RoleDefinition>` — edit the `description`/`prompt` strings there to customize behavior. The current `prompt` values are placeholders (e.g. ``You are a subagent with the role `coder`.``); flesh them out with real role-specific instructions as needed.

Role is stored on the sub-agent's registry entry and shown in `list` output and in the tool-call rendering, e.g.:

```
Tracked sub-agents:
  coder-1 pane=%12 role=coder (Implements a well-defined piece of work...) mailbox=/tmp/pi-mailbox/coder-1 [alive]
```

## File-Mailbox Protocol

The sub-agent's injected system prompt instructs it to follow a file-based protocol for replies:

1. **Compose the reply** in response to the parent's message (normal `pi` behavior)
2. **Write to file**: When done, write the entire reply to `<mailboxDir>/out.txt` (plain text, no special encoding)
3. **Signal completion**: Create an empty marker file `<mailboxDir>/out.done` to signal that the reply is ready

The parent's `read` action:
- Polls for `out.done` (cheap `stat` check) with backoff
- Reads `out.txt` and extracts the reply text
- Deletes both `out.txt` and `out.done` to clean up for the next round
- Returns the reply to the parent's context

**Advantages over other approaches:**
- No TUI scraping: avoids fragile terminal parsing, ANSI codes, and delta tracking
- Deterministic completion signal: the existence of `out.done` is a boolean, not parsed from output
- Clean payload: the reply text is plain text, with no box-drawing or TUI formatting
- Single tool call: the internal polling loop completes within one `read` call (no extra LLM turns)

---

## Worked Example: Ping-Pong Validation

This example demonstrates the full send/read cycle in practice.

### Scenario
You are in a `pi` session and want to spawn a sub-agent, ask it a simple question, and retrieve the answer.

### Steps

1. **Spawn the sub-agent:**
   ```
   I need to set up a helper. Can you spawn a new sub-agent named "helper"?
   ```
   → Pi calls `tmux_agent` with `action="spawn", name="helper"`
   → Response: Pane created at `/tmp/pi-mailbox/helper`

2. **Send a message:**
   ```
   Now send "ping" to the helper and ask it to reply "pong" via the mailbox.
   ```
   → Pi calls `tmux_agent` with `action="send", name="helper", text="ping"`
   → Message delivered to helper's prompt
   → Helper's TUI shows "ping" as input

3. **Helper processes and replies:**
   → Helper (now another `pi` instance) sees "ping" in its prompt
   → It composes a reply: "pong"
   → It writes "pong" to `/tmp/pi-mailbox/helper/out.txt`
   → It creates `/tmp/i-mailbox/helper/out.done` to signal completion

4. **Read the reply:**
   ```
   Read the reply from helper.
   ```
   → Pi calls `tmux_agent` with `action="read", name="helper"`
   → Tool polls for `out.done`, finds it within a few milliseconds
   → Tool reads `out.txt`: "pong"
   → Tool deletes both files
   → Tool returns: "pong"
   → Pi shows the reply in its context

5. **Verify with a second round:**
   ```
   Send "ping" again to helper and verify it replies "pong" again.
   ```
   → Same cycle: send, helper writes mailbox files, read retrieves the reply
   → Confirms the mailbox was properly cleaned and can be reused

### Key Observations
- Both `send` and `read` complete in a single tool call each
- No extra LLM turns are spent on polling or intermediate status checks
- The mailbox is cleaned after each read, ready for the next send/read pair
- The protocol is generic (not hardcoded for "ping"/"pong"); any sub-agent reply works

---

## Security Model

### Trust Level: Same as Parent Agent

Sub-agents spawned by this extension run as **full `pi` instances with the same tool and shell access as the parent agent**. 

**Security implications:**
- A sub-agent pane can execute any tool available to the parent: `bash`, `read`, `write`, `edit`, etc.
- A sub-agent can read any file, run any shell command, and access any API key or credential available to the parent process
- The sub-agent inherits the parent's environment: `$HOME`, `.pi/` config, credentials, SSH keys, etc.

**Recommendation:** Only spawn sub-agents for tasks you trust. Since the parent agent is already capable of all this, delegating to a sub-agent does not introduce new attack surface—it is a convenience mechanism for task decomposition, not a security boundary.

### Mailbox Directory

The mailbox directory (`/tmp/pi-mailbox/<name>/`) is world-readable by default on most systems. 

**Consideration:** Any process on the system could potentially read `out.txt` while it contains sensitive data. For production use, consider:
- Running `pi` processes with restricted umask or in a sandboxed environment
- Using more restricted permissions on `/tmp` (e.g., `mount -o mode=700`)
- Clearing `/tmp/pi-mailbox/` on startup to remove stale files from previous sessions

---

## Error Handling

### tmux Not Available
If tmux is not installed or not in `$PATH`:
```
Error: tmux is not available. Ensure tmux 3.0+ is installed and in PATH.
```

### Not Inside a tmux Session
If the parent `pi` process is not running inside a tmux session:
```
Error: Not running inside a tmux session (TMUX env var not set).
```

### Sub-agent Not Found (send/read/kill)
Attempting to send/read/kill a sub-agent that was never spawned or has been killed:
```
Error: Sub-agent "research" not found. Use list to see active sub-agents.
```

### read Timeout
If the sub-agent does not write `out.done` within the timeout:
```
Timeout: No reply from "research" after 60000ms
(Mailbox files left for debugging; manually clear /tmp/pi-mailbox/research/ to retry)
```

### Pane Already Dead (kill)
If you call `kill` on a sub-agent pane that has already exited:
```
Killed sub-agent "research" (was already dead)
```
No error is thrown; the action completes successfully.

---

## Limitations & Future Work

### Current Limitations
- **send-keys length**: Very long messages (> 2000 chars) may hit tmux's send-keys limit. Work around by sending multiple shorter messages or storing large data in files.
- **Sub-agent compliance**: The sub-agent must reliably follow the mailbox protocol (write `out.txt`, then create `out.done`). This is a convention enforced by the injected system prompt, not a hard guarantee.
- **Pane reconstruction**: Currently, the sub-agent registry is in-memory only. If the parent `pi` session reloads, active sub-agents are lost. A future version will reconstruct the registry from tool-result details.
- **Single tmux session**: All spawned panes must be in the same tmux session as the parent. Cross-session / cross-machine panes are not supported.

### Out of Scope (PoC Phase)
- Concurrent sub-agent management (registering/tracking many dozens of panes)
- Cleanup/recovery from abandoned panes
- RPC-mode sub-agents (headless JSON mode)
- SSH/remote panes
- Binary or control-character content in messages

---

## Troubleshooting

### Sub-agent appears stuck or unresponsive
1. Check the pane's TUI directly: `tmux select-pane -t abc123` (use pane ID from `list`)
2. The sub-agent might be waiting for input or stuck on a long-running command
3. Send a message or press Ctrl+C in the pane's tmux view to interrupt

### Mailbox files not cleaning up
1. Check the mailbox directory: `ls -la /tmp/pi-mailbox/<name>/`
2. If `out.done` is not removed after `read`, the action may have timed out; manually delete: `rm -rf /tmp/pi-mailbox/<name>`
3. Consider a higher timeout for slow sub-agents: `action="read", name="...", timeout=120000`

### Panes accumulating
1. Use `list` to see all active panes
2. Use `kill` to clean up old panes: `action="kill", name="..."`
3. Or kill manually in tmux: `tmux kill-pane -t abc123`

---

## Examples

### Example 1: Spawn and communicate with a sub-agent

```
I need to analyze a large codebase. Spawn a sub-agent named "analyzer" to help.
```

Then:

```
Send "Analyze the structure of the `src/` directory and summarize the modules" to the analyzer.
```

Then:

```
Read the analyzer's response (wait up to 2 minutes if needed).
```

### Example 2: Multiple sub-agents

```
Spawn two sub-agents: "scout" and "reviewer". Send them both to analyze different parts
of the codebase. Read their replies in sequence.
```

### Example 3: Clean up after work

```
List all sub-agents. Kill the ones that are done.
```

---

## Technical Details

### Component Files

| File | Purpose |
|------|---------|
| `index.ts` | Main extension entry point; registers `tmux_agent` tool |
| `tmux.ts` | CLI wrappers for tmux: `splitWindow`, `sendKeys`, `setPaneTitle`, `listPanes`, `killPane`, etc. |
| `registry.ts` | In-memory `Registry` class tracking `name → {paneId, mailboxDir}` |
| `polling.ts` | `waitForFile` utility: polls for file existence with exponential backoff + AbortSignal |
| `prompt.ts` | Stub for sub-agent system prompt injection (file-mailbox protocol instructions) |
| `roles.ts` | Role definitions (`planner`/`scout`/`coder`/`reviewer`): parent-facing `description` + sub-agent-facing `prompt` addendum |

### Design Decisions

- **Single tool with actions**: `tmux_agent` has an `action` param (StringEnum) rather than separate tools per action, reducing cognitive load and keeping the registry scoped to one tool
- **Asymmetric channel**: Parent→sub uses direct `send-keys` (no file indirection); sub→parent uses file mailbox (avoids TUI scraping fragility)
- **In-memory registry**: Simplicity for PoC; panes are tied to the parent's session lifetime. (Reconstruction from session details planned for future version)
- **Full TUI sub-agents**: Not headless JSON mode, so sub-agents can interact with the user, see pretty-printed output, and inspect their own state

### Polling Backoff Strategy

The `read` action uses exponential backoff for polling `out.done`:
- Initial delay: 300ms
- Multiplier: 1.5× per iteration
- Cap: 2000ms (2 seconds)
- Example sequence: 300ms, 450ms, 675ms, 1012ms, 1518ms, 2000ms, 2000ms, ...

This balances responsiveness (quick initial checks) with low CPU usage for longer waits.

---

## License & Contributing

This extension is part of the pi-coding-agent project. See the main repository for license and contribution guidelines.
