# Default Skills

This directory contains skill implementations that are bundled with the Desktop App and installed automatically on first run.

## Structure

Each subdirectory represents a single skill:

```
skills/
├── skill-name-1/
│   ├── SKILL.md
│   └── handler.ts
├── skill-name-2/
│   ├── SKILL.md
│   └── handler.ts
```

## Adding a New Default Skill

1. Create a new subdirectory for your skill (e.g., `web-search/`)
2. Add `SKILL.md` with skill metadata and documentation
3. Add handler code files as needed
4. Update `apps/electron/config/first-run-defaults.json` to add the skill name to the `skills.enabled` array

The skill will be copied to the user's workspace during first-time setup.
