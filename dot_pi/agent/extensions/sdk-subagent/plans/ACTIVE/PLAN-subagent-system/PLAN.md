## Plan

Build a pi extension that provides a `sdk-subagent` tool for the orchestrator agent. The core is a functional subagent system: the orchestrator can spawn role-based subagents, send instructions to them, list active agents, and kill them — all via a single tool with multiple actions. Subagent roles are defined in a TypeScript config file (`roles.ts`) for easy editing. The `/subagents` slash command is registered as a placeholder for a future TUI plan.

## Tasks

### 01-extension-boilerplate
Difficulty to implement : 2
Description of the task : Create the pi extension skeleton under `.pi/extensions/` with TypeScript setup. Register the `sdk-subagent` tool with multiple actions (spawn, list, kill, send) and the `/subagents` slash command placeholder for the future TUI.

### 02-role-config
Difficulty to implement : 2
Description of the task : Create the `roles.ts` configuration file where users can define subagent roles. Each role specifies: name, system prompt, toolset (Scout=read-only, Coder=read+edit+write, Reviewer=read-only), and any custom parameters. Make it intuitive to add/remove/edit roles.

### 03-subagent-runtime
Difficulty to implement : 3
Description of the task : Build the core subagent runtime. When `spawn` is called, create a new SDK agent session with the role's config (tools, system prompt, etc.) — no task yet. Track active subagents in memory with their session, status, and metadata. Implement streaming event subscription and polling for result retrieval.

### 04-tool-actions
Difficulty to implement : 3
Description of the task : Implement all `sdk-subagent` tool actions:
- `spawn` — create a new subagent with a role (applies system prompt only, no task)
- `list` — return active subagents with status
- `kill` — terminate a subagent session
- `send` — dispatch an instruction/task to an existing subagent

### 05-orchestrator-workflow
Difficulty to implement : 2
Description of the task : Ensure the orchestrator agent can naturally use the tool in sequence: spawn → send → read results → kill. Handle edge cases (spawn when already running, send to non-existent agent, etc.). Add streaming progress and polling completion support.

### 06-testing-and-polish
Difficulty to implement : 2
Description of the task : Test the full orchestrator flow: spawn a subagent, send instructions, verify streaming progress and polling completion, kill. Polish the tool output, add error handling, and document the `roles.ts` config format.
