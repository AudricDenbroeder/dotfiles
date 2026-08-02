## Task: orchestrator-workflow

### Overview
Ensure the orchestrator agent can naturally use the tool in sequence: spawn → send → read results → kill. Handle edge cases and add streaming progress + polling completion support.

### Subtasks
- [ ] Wire up tool actions to SubagentManager
- [ ] Handle edge cases (duplicate spawn, send to dead agent, etc.)
- [ ] Add streaming progress and polling completion support

### Implementation Details
- In `execute()`, route each action to the corresponding SubagentManager method
- Edge cases:
  ```typescript
  // spawn with duplicate ID
  if (manager.get(params.id)) {
    return { content: [{ text: `Subagent ${params.id} already exists` }], details: { error: true } };
  }
  
  // send to non-existent
  const sub = manager.get(params.id);
  if (!sub) {
    const available = manager.list().map(s => s.id).join(", ");
    return { content: [{ text: `Subagent ${params.id} not found. Available: ${available}` }], details: { error: true } };
  }
  
  // kill non-existent
  if (!manager.kill(params.id)) {
    return { content: [{ text: `Subagent ${params.id} not found` }], details: { error: true } };
  }
  ```
- Streaming support in `send`:
  ```typescript
  async function handleSend(params, ctx) {
    const sub = manager.get(params.id);
    if (!sub) return error(...);
    
    sub.status = 'running';
    
    // Stream progress
    const unsubscribe = sub.session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        onUpdate?.({ content: [{ type: "text", text: event.assistantMessageEvent.delta }] });
      }
    });
    
    // Send message
    await sub.session.prompt(params.message);
    
    unsubscribe();
    sub.status = 'idle';
    
    return { content: [{ text: `Instruction sent to ${params.id}` }], details: { success: true, id: params.id } };
  }
  ```
- Polling support — after `send`, check status:
  ```typescript
  // In list action, show current status
  // User can poll by calling list repeatedly
  ```
- Return helpful messages:
  - `spawn`: `"Spawned scout-1 with role Scout. Use sdk-subagent send to give it a task."`
  - `send`: `"Sent instruction to scout-1 (status: running)"`
  - `list`: `"Active subagents:\n- scout-1 (running)\n- coder-2 (idle)"`

### Acceptance Criteria
- [ ] Full sequence works: spawn → send → list (shows running) → list (shows idle) → kill
- [ ] Duplicate spawn returns appropriate error
- [ ] Send to non-existent agent returns error with available IDs
- [ ] Streaming progress is captured and visible via `onUpdate`
- [ ] Polling can detect completion status via `list`
