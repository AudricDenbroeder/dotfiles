## Task: extension-boilerplate

### Overview
Create the pi extension skeleton under `.pi/extensions/`. Register the `sdk-subagent` tool using `pi.registerTool()` and the `/subagents` slash command placeholder using `pi.registerCommand()`.

### Subtasks
- [ ] Create `.pi/extensions/sdk-subagent/` directory with `index.ts` entry point
- [ ] Set up the extension factory function receiving `ExtensionAPI`
- [ ] Register `sdk-subagent` tool skeleton with `pi.registerTool()`
- [ ] Register `/subagents` command placeholder with `pi.registerCommand()`
- [ ] Add `session_start` and `session_shutdown` event handlers for lifecycle

### Implementation Details
- Create `.pi/extensions/sdk-subagent/index.ts`
- Extension factory:
  ```typescript
  import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
  import { Type } from "typebox";
  import { StringEnum } from "@earendil-works/pi-ai";
  
  export default function (pi: ExtensionAPI) {
    // Lifecycle
    pi.on("session_start", () => { /* init state */ });
    pi.on("session_shutdown", () => { /* cleanup */ });
    
    // Tool
    pi.registerTool({
      name: "sdk-subagent",
      label: "SDK Subagent",
      description: "Manage subagent instances: spawn, list, kill, send instructions",
      parameters: Type.Object({
        action: StringEnum(["spawn", "list", "kill", "send"] as const),
        // optional params
      }),
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        // route to handler
      }
    });
    
    // Command placeholder
    pi.registerCommand("subagents", {
      description: "Open subagent management TUI (placeholder)",
      handler: async (_args, ctx) => {
        ctx.ui.notify("Subagent TUI coming soon!", "info");
      }
    });
  }
  ```
- No `package.json` needed for simple extensions (jiti handles TypeScript directly)
- Place in `.pi/extensions/sdk-subagent/index.ts` for project-local discovery

### Acceptance Criteria
- [ ] Extension loads without errors when pi starts
- [ ] `sdk-subagent` tool is registered and visible in tool list
- [ ] `/subagents` command is callable and shows placeholder message
- [ ] `session_start` and `session_shutdown` handlers are registered
