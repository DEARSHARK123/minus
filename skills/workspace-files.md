# Skill: workspace-files

File I/O for Minus Desktop tools is restricted.

## Allowed paths (under MINUS_WORKSPACE)

| Action | Allowed roots |
|--------|----------------|
| **write** / **delete** | `artifacts/` only |
| **read** / **list** | `artifacts/` and `inputs/` |

## Rules

- Create `artifacts/` if missing before writing.
- Never write outside `artifacts/` (no project source edits via file_manager).
- Never read arbitrary absolute paths or escape the workspace with `..`.
- Prefer relative paths like `artifacts/notes.md` or `inputs/data.csv`.
- Dangerous tools (code_executor, web_search, data_analyzer, etc.) require **user confirmation** (HITL) before execution.
