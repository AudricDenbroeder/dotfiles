# Permission Gate Extension

A guardrail extension that prompts for confirmation before running dangerous bash commands. Patterns are loaded from a configurable JSON file.

## Usage

```bash
# Load the extension
pi --extension extensions/permission-gate/permission-gate.ts
```

## Configuration

Edit `permission-gate-config.json` in the same directory:

```json
{
  "patterns": [
    "\\brm\\s+(-rf?|--recursive)\\b",
    "\\bsudo\\b",
    "\\b(chmod|chown)\\b.*777\\b"
  ],
  "allowlist": []
}
```

### `patterns`

Array of regex patterns (as strings) that match dangerous commands. The extension tests each bash command against these patterns (case-insensitive). When a match is found, the user is prompted for confirmation.

### `allowlist`

Array of bypass entries. If a command matches any allow-list entry, it bypasses gating entirely — no prompt, no block.

Two formats supported:

**Substring match** (plain string):
```json
"allowlist": [
  "rm -rf /tmp/my-cache",
  "sudo --version"
]
```
Any command containing that exact substring is allowed.

**Regex match** (wrapped in `/`):  
```json
"allowlist": [
  "/^sudo --version/",
  "/^rm\\s+.*\\/tmp\\//i"
]
```
Uses JavaScript `RegExp.test()` — flags after the closing `/` (e.g. `i` for case-insensitive).

## Behavior

- **Interactive mode** (has UI): Shows a confirmation dialog; user can allow or block.
- **Non-interactive mode** (no UI): Blocks by default and returns an error.
