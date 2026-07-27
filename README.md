# Skills Deck

Declaratively manage Agent Skills across Claude Code, Codex, Cursor, Windsurf,
GitHub Copilot, and other compatible agents.

Declare the skills you want once. Skills Deck scans what is installed,
compares it with that declaration, and shows the difference without duplicating
installed state in its data file.

## Features

- Reconcile wanted and installed skills with clear status indicators
- Scan global and workspace skill directories across supported AI agents
- Add skills from GitHub, skills.sh commands, skillhub.cn links, or local paths
- Discover and selectively install skills from multi-skill GitHub repositories
- Update repositories to find new skills and refresh installed skill code
- Install, uninstall, and update in the background without opening a terminal
- Manage multiple selected skills from context menus
- Group by category, source, status, or scope from one toolbar menu
- Filter by installation state and search by skill name or ID
- Inspect the selected skill in a native Details view
- Keep declarations in a portable `data.json`

## Repository model

Skills remain the smallest management unit. A repository provides shared
source, category, and wanted defaults, while each child skill can override
them.

Single-skill repositories render directly as skill items. Multi-skill
repositories use a compact parent node so their children stay organized without
changing skill-level grouping, filtering, or status behavior.

## Status model

| Status | Meaning |
| --- | --- |
| `wanted-installed` | Declared and installed |
| `wanted-missing` | Declared but not installed |
| `unwanted-installed` | Marked unwanted but still installed |
| `unwanted-missing` | Marked unwanted and absent |
| `extra` | Installed but not declared |

## Usage

Open **Skills Deck** from the Activity Bar.

1. Use **Add Skill** to declare a skill and optionally install it.
2. Use **Sync Installed → List** to initialize declarations from your machine.
3. Use **Sync List → Install** to reconcile installed skills with the list.
4. Use the **Group By** dropdown to switch between category, source, status,
   scope, and a flat list.
5. Right-click a multi-skill repository to discover new skills and update its
   installed children.

Local sources are installed as symbolic links. Other supported sources are
installed through the `skills` CLI in the background.

## Data

Declarations are stored in the extension global storage directory as
`data.json`. Use **Open data.json** from the view menu to locate or edit it.
Because the file contains declarations rather than a snapshot of every agent
directory, it can be copied, symlinked, or managed by an external dotfiles tool.

## Development

```sh
npm install
npm run typecheck
npm run build
```

Press `F5` in VS Code to launch an Extension Development Host.
