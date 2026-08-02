## Task: subagent-runtime

### Overview
Build the core subagent runtime. When `spawn` is called, create a new SDK agent session with the role's config. Track active subagents in memory. Implement streaming event subscription and polling for result retrieval.

### Subtasks
- [ ] Create `SubagentManager` class to track active subagents
- [ ] Implement spawn logic — create SDK session with role config
- [ ] Implement streaming event subscription and polling for results
- [ ] Persist subagent state in tool `details` for branching support

### Implementation Details
- Create `.pi/extensions/sdk-subagent/SubagentManager.ts`
- `SubagentManager` class:
  ```typescript
  import type { AgentSession } from "@earendil-works/pi-coding-agent";
  import type { RoleConfig } from "./roles";
  
  export interface SubagentInstance {
    id: string;
    role: RoleConfig;
    session: AgentSession;
    status: 'idle' | 'running' | 'error';
    createdAt: Date;
    lastActivity?: Date;
  }
  
  export interface SubagentStatus {
    id: string;
    role: string;
    status: 'idle' | 'running' | 'error';
    createdAt: string;
  }
  
  export class SubagentManager {
    private subagents: Map<string, SubagentInstance> = new Map();
    
    spawn(roleName: string, cwd?: string): string | null {
      // Find role, create SDK session, store in map
      // Return ID or null if role not found
    }
    
    get(id: string): SubagentInstance | undefined {
      return this.subagents.get(id);
    }
    
    list(): SubagentStatus[] {
      return Array.from(this.subagents.values()).map(s => ({
        id: s.id,
        role: s.role.name,
        status: s.status,
        createdAt: s.createdAt.toISOString()
      }));
    }
    
    kill(id: string): boolean {
      const sub = this.subagents.get(id);
      if (sub) {
        sub.session.abort();
        sub.session.dispose();
        this.subagents.delete(id);
        return true;
      }
      return false;
    }
    
    send(id: string, message: string): Promise<{ success: boolean; streaming?: boolean }> {
      // Dispatch message to subagent session
    }
  }
  ```
- Use `createAgentSession()` from SDK to create sessions:
  ```typescript
  import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
  
  const { session } = await createAgentSession({
    cwd,
    sessionManager: SessionManager.inMemory(cwd),
    tools: role.tools, // role-specific toolset
  });
  ```
- Set system prompt via resource loader or by injecting into session
- Subscribe to streaming events:
  ```typescript
  session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      // Capture streaming text
    }
  });
  ```
- Poll for completion:
  ```typescript
  // Check after send
  await session.agent.waitForIdle();
  const messages = session.agent.state.messages;
  ```
- Store state in `details` for persistence:
  ```typescript
  return {
    content: [{ type: "text", text: `Spawned: ${id}` }],
    details: { subagents: this.serializeState() }
  };
  ```

### Acceptance Criteria
- [ ] `SubagentManager` can spawn a subagent with a valid role
- [ ] Spawned subagent has an active SDK session
- [ ] Active subagents are tracked in memory with status
- [ ] Streaming events are captured during subagent execution
- [ ] Polling can detect when a subagent finishes its turn
- [ ] State can be serialized and restored
