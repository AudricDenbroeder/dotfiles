## Task: tool-actions

### Overview
Implement all `sdk-subagent` tool actions: spawn, list, kill, and send. Each action takes parameters and returns structured results.

### Subtasks
- [ ] Implement `spawn` action — create subagent with role, return ID
- [ ] Implement `list` action — return active subagents with status
- [ ] Implement `kill` action — terminate subagent session
- [ ] Implement `send` action — dispatch instruction to existing subagent

### Implementation Details
- Tool definition in `index.ts`:
  ```typescript
  pi.registerTool({
    name: "sdk-subagent",
    label: "SDK Subagent",
    description: "Manage subagent instances: spawn, list, kill, send instructions",
    promptSnippet: "Spawn, list, kill, or send instructions to subagent instances",
    promptGuidelines: [
      "Use sdk-subagent to spawn a subagent with a specific role.",
      "Use sdk-subagent to list active subagents and their status.",
      "Use sdk-subagent to send instructions to an existing subagent.",
      "Use sdk-subagent to kill a subagent when done.",
    ],
    parameters: Type.Object({
      action: StringEnum(["spawn", "list", "kill", "send"] as const),
      role: Type.Optional(Type.String({ description: "Role name for spawn (e.g., Scout, Coder, Reviewer)" })),
      id: Type.Optional(Type.String({ description: "Subagent ID for kill/send" })),
      message: Type.Optional(Type.String({ description: "Instruction message for send action" })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      switch (params.action) {
        case "spawn": return handleSpawn(params, ctx);
        case "list": return handleList(ctx);
        case "kill": return handleKill(params, ctx);
        case "send": return handleSend(params, ctx);
        default: return { content: [{ type: "text", text: "Invalid action" }] };
      }
    }
  });
  ```
- **spawn** params: `role` (string), optional `id` (string)
  - Returns: `{ content: [{ text: `Spawned ${id} with role ${role}` }], details: { id, role, status } }`
- **list** params: none
  - Returns: `{ content: [{ text: JSON.stringify(list, null, 2) }], details: { subagents } }`
- **kill** params: `id` (string)
  - Returns: `{ content: [{ text: `Killed ${id}` }], details: { success, id } }`
- **send** params: `id` (string), `message` (string)
  - Returns: `{ content: [{ text: `Sent to ${id}` }], details: { success, id, streaming: true } }`
- Validate action and required params before executing
- Return errors as structured content:
  ```typescript
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    details: { error: true, message }
  };
  ```

### Acceptance Criteria
- [ ] `spawn` creates a subagent and returns its ID
- [ ] `list` returns all active subagents with current status
- [ ] `kill` terminates a subagent and removes it from tracking
- [ ] `send` dispatches a message to an existing subagent
- [ ] Invalid actions or missing params return clear errors
- [ ] All actions return structured content with details
