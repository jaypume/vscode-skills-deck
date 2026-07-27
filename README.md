# Skills Deck

Declare the Agent Skills you want; let Skills Deck reconcile the rest — right
inside VS Code.

[English](#english) · [中文](README.zh-CN.md)

![Skills Deck demo](media/demo.gif)

## English

Skills Deck holds a single list of the skills you *want*, diffs it against what
is actually installed on disk, and surfaces only the gaps — what to install, what
to remove, what is out of sync across Agents.

### Features

- **Want vs. installed** — keep "do I want it" (Wanted / Unwanted) separate from
  "is it there" (Installed / Missing), so the actions you need are always clear.
- **One list, many Agents** — maintain the declaration once and sync it to Claude
  Code, Codex, Pi, OpenCode, Cursor, GitHub Copilot, Gemini CLI, Windsurf, Roo,
  Kilo, Kiro, Continue, Goose, Trae, Amp, or a custom Agent.
- **Single source of truth** — all skills live in `~/.agents/skills`; enabled
  Agents get managed symlinks, so removing a link never deletes the skill and
  switching Agents costs you nothing.
- **Bring skills from anywhere** — add them from GitHub, `skills.sh` commands,
  skillhub.cn, or local directories.
- **Multi-skill repositories** — discover the skills inside a repo, then select,
  update, or remove them per skill or per repository.
- **Native VS Code UI** — TreeView grouping, search, multi-select, context menus,
  Details, tooltips, notifications, with the heavy lifting in the background.
- **Per-Agent diff** — spot missing links, broken links, local overrides, and
  skills an Agent installed on its own. Read-only reconciliation — your local
  content is never overwritten.
- **Skill notes** — jot down personal evaluations or reminders right from Details.
- **Quick navigation** — jump to a GitHub repo, the local source directory,
  `SKILL.md`, an Agent's skills directory, or `data.json` in one click.
- **Portable state** — desired state lives in a compact `data.json`; actual
  install state is always derived from disk, never stored twice.

### Quick Start

1. Open **Skills Deck** from the Activity Bar.
2. Configure enabled Agents in the **Agents** view.
3. Use **Add Skill** or **Sync to Data (Install State → List)** to populate your
   declaration list.
4. Use **Sync from Data (List → Install)** to reconcile the global library and
   enabled Agents.

Remote operations run through the `skills` CLI in the background. Local sources
use symlinks. Project-local skill management is currently disabled to keep the
global model predictable.

## Requirements

- VS Code 1.93 or later
- Node.js and npm for remote install, update, and uninstall operations

## License

[Apache License 2.0](LICENSE)
