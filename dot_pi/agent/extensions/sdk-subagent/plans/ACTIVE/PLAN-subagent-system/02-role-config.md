## Task: role-config

### Overview
Create the `roles.ts` configuration file where users can define subagent roles. Each role specifies name, system prompt, toolset, and description. Include default roles: Scout (read-only), Coder (read+edit+write), Reviewer (read-only).

### Subtasks
- [ ] Define the `RoleConfig` TypeScript interface
- [ ] Create default `roles.ts` with Scout, Coder, and Reviewer roles
- [ ] Add role loading and validation in the extension

### Implementation Details
- Create `.pi/extensions/sdk-subagent/roles.ts`
- `RoleConfig` interface:
  ```typescript
  export interface RoleConfig {
    name: string;
    label?: string;
    systemPrompt: string;
    tools: string[]; // tool names to enable for this role
    description?: string;
  }
  ```
- Default roles:
  ```typescript
  export const roles: RoleConfig[] = [
    {
      name: "Scout",
      label: "Scout",
      description: "Read-only investigation and research",
      tools: ["read", "grep", "find", "ls"],
      systemPrompt: `You are a Scout. Your role is to investigate, research, and gather information. You have read-only access to the filesystem. Use your tools to explore, search, and report findings. Do not modify any files.`
    },
    {
      name: "Coder",
      label: "Coder",
      description: "Full write access for implementation",
      tools: ["read", "bash", "edit", "write"],
      systemPrompt: `You are a Coder. Your role is to implement code, edit files, and run commands. You have full read/write access. Follow instructions carefully and make the requested changes.`
    },
    {
      name: "Reviewer",
      label: "Review",
      description: "Read-only code review and analysis",
      tools: ["read", "grep", "find", "ls"],
      systemPrompt: `You are a Reviewer. Your role is to review code, analyze changes, and provide feedback. You have read-only access. Examine the code thoroughly and provide constructive feedback.`
    }
  ];
  ```
- In `index.ts`, import and validate roles:
  ```typescript
  import { roles } from "./roles";
  
  // Validate on load
  for (const role of roles) {
    if (!role.name || !role.systemPrompt || !role.tools) {
      console.warn(`Invalid role config: ${role.name ?? "unnamed"}`);
    }
  }
  ```
- Export `roles` array for use by the runtime

### Acceptance Criteria
- [ ] `roles.ts` exports an array of `RoleConfig` objects
- [ ] Scout, Coder, and Reviewer roles are defined with appropriate toolsets
- [ ] Roles are validated on load (logged warnings for invalid config)
- [ ] Users can add/edit/remove roles by editing `roles.ts`
