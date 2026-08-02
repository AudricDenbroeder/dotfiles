## Task: testing-and-polish

### Overview
Test the full orchestrator flow and polish the extension. Add error handling, edge case guards, and document the `roles.ts` config format.

### Subtasks
- [ ] Test full spawn → send → kill flow end-to-end
- [ ] Add error handling and edge case guards
- [ ] Document `roles.ts` config format and extension usage

### Implementation Details
- Manual testing in pi:
  1. Start pi with extension loaded (place in `.pi/extensions/sdk-subagent/index.ts`)
  2. Ask orchestrator: "Spawn a scout to investigate the current directory"
  3. Check tool result shows the spawned ID
  4. Ask: "Send 'list all TypeScript files' to scout-1"
  5. Verify streaming output appears in the TUI
  6. Check `list` shows running status
  7. Wait for completion, check `list` shows idle
  8. Ask: "Kill scout-1"
  9. Verify it's removed from active list

- Error handling improvements:
  - Invalid role name → `"Role 'foo' not found. Available: Scout, Coder, Reviewer"`
  - Session creation failure → log error, return `{ error: true, message: "Failed to spawn" }`
  - Tool execution errors → throw to set `isError: true` on result
  - Aborted signals → check `signal?.aborted` and return cancellation message

- Documentation in `README.md` or inline comments:
  ```markdown
  ## sdk-subagent Extension
  
  ### Roles Configuration
  Edit `.pi/extensions/sdk-subagent/roles.ts` to add/modify roles.
  
  Each role has:
  - `name`: Unique identifier
  - `label`: Display name
  - `systemPrompt`: System prompt for the subagent
  - `tools`: Array of tool names to enable
  
  ### Tool Actions
  - `spawn`: Create a new subagent with a role
  - `list`: List active subagents
  - `kill`: Terminate a subagent
  - `send`: Send an instruction to a subagent
  
  ### Example Usage
  1. Spawn: `sdk-subagent(action: "spawn", role: "Scout")`
  2. Send: `sdk-subagent(action: "send", id: "scout-1", message: "List files")`
  3. List: `sdk-subagent(action: "list")`
  4. Kill: `sdk-subagent(action: "kill", id: "scout-1")`
  ```

### Acceptance Criteria
- [ ] Full flow tested manually in pi: spawn → send → list → kill
- [ ] All edge cases return clear error messages
- [ ] `roles.ts` is documented with config format
- [ ] Extension logs useful information on spawn/kill/send
- [ ] No unhandled exceptions during normal operation
- [ ] Streaming progress visible in TUI during subagent execution
