# Default Hooks

This directory contains hook implementations that are bundled with the Desktop App and installed automatically on first run.

## Structure

Each subdirectory represents a single hook:

```
hooks/
├── hook-name-1/
│   ├── HOOK.md
│   └── handler.ts
├── hook-name-2/
│   ├── HOOK.md
│   └── handler.ts
```

## Adding a New Default Hook

1. Create a new subdirectory for your hook (e.g., `memory/`)
2. Add `HOOK.md` with hook metadata and documentation
3. Add handler code files as needed
4. Update `apps/electron/config/first-run-defaults.json` to add the hook name to the `hooks.enabled` array

The hook will be copied to `~/.openclaw/hooks/` during first-time setup.
