## Task: Tree List Data Model

### Overview
Turn the flat subagent map exposed by `SubagentManager` into an ordered tree (using the `parentId` field from task 01) with per-row depth and `tree`-command-style connector prefixes, so the list component (task 03) can render indentation by just printing precomputed strings.

### Subtasks
- [ ] Implement a `buildSubagentTree(instances)` helper that groups instances by `parentId`, computes DFS preorder traversal (root nodes first, each node's children immediately after it), and returns rows annotated with `depth` and the instance itself.
- [ ] Compute `tree`-style connector prefixes per row (`├── `, `└── `, `│   `, `    `) based on whether each ancestor level is the last sibling at that level, matching how the Unix `tree` command draws branches.
- [ ] Handle orphaned `parentId`s (parent already killed/missing) by treating that node as a root instead of dropping it.

### Implementation Details
- Suggested location: a new exported function in `SubagentManager.ts` (e.g. `export function buildSubagentTree(list: SubagentStatus[] | SubagentInstance[]): SubagentTreeRow[]`), or a small new `tree.ts` file in the extension folder if that keeps `SubagentManager.ts` cleaner — either is fine, just export it so task 03 can import it directly.
- Suggested row shape:
  ```ts
  interface SubagentTreeRow {
    id: string;
    depth: number;
    prefix: string;        // e.g. "│   ├── "
    isLast: boolean;       // last child among its siblings
    instance: SubagentStatus; // or SubagentInstance, whichever the list component needs
  }
  ```
- Algorithm sketch: build a `Map<parentId|undefined, SubagentStatus[]>` of children lists (preserving `createdAt` order or manager insertion order as the sibling order), then recursively walk starting from the `undefined`/root bucket, carrying an `ancestorIsLast: boolean[]` stack down to build each row's prefix (append `"│   "` or `"    "` per ancestor, then `"├── "`/`"└── "` for the current node depending on `isLast`).
- Keep the function pure (no side effects, no manager state mutation) so it's easy to call every time the list needs to re-render.

### Acceptance Criteria
- [ ] Given a manager with only root-level subagents (today's only real scenario, since no role has the `sdk-subagent` tool yet), the function returns them all at `depth: 0` with empty prefixes — i.e. behaves like a flat list.
- [ ] Given a synthetic set of instances with `parentId` links set manually (for manual testing purposes), the function produces prefixes visually matching `tree` command output for an equivalent directory structure.
- [ ] A node whose `parentId` points to a non-existent/killed instance is still included, at root depth, rather than being silently dropped.
