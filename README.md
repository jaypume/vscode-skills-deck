# Skills Manager

Declaratively manage Agent Skills across Claude Code, Codex, Cursor, Windsurf,
GitHub Copilot, and other compatible agents.

Declare the skills you want once. Skills Manager scans what is installed,
compares it with that declaration, and shows the difference without duplicating
installed state in its data file.

## Features

- Reconcile wanted and installed skills with clear status indicators
- Scan global and workspace skill directories across supported AI agents
- Add skills from GitHub, skills.sh commands, skillhub.cn links, or local paths
- Install and remove skills from the declared list
- Group by category, source, status, or scope from one toolbar menu
- Filter by installation state and search by skill name or ID
- Inspect the selected skill in the Details view
- Keep declarations in a portable `data.json`

## Status model

| Status | Meaning |
| --- | --- |
| `wanted-installed` | Declared and installed |
| `wanted-missing` | Declared but not installed |
| `unwanted-installed` | Marked unwanted but still installed |
| `unwanted-missing` | Marked unwanted and absent |
| `extra` | Installed but not declared |

## Usage

Open **Skills Manager** from the Activity Bar.

1. Use **Add Skill** to declare a skill and optionally install it.
2. Use **Sync Installed → List** to initialize declarations from your machine.
3. Use **Sync List → Install** to reconcile installed skills with the list.
4. Use the **Group By** dropdown to switch between category, source, status,
   scope, and a flat list.

Local sources are installed as symbolic links. Other supported sources are
installed through the `skills` CLI.

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
