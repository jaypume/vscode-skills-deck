# AGENTS.md

## Communication

- Communicate with the user in concise, professional Chinese.
- Keep code, logs, comments, command names, and release notes in English.
- Lead with the result and avoid long implementation recaps.

## Product Intent

Skills Manager is a declarative VS Code manager for Agent Skills. The persisted
list represents desired state; the scanner observes installed state; reconcile
derives the difference at runtime.

The product should feel like a native VS Code view: compact, contextual, and
easy to scan. Prefer TreeView, QuickPick, ThemeIcon, context menus, progress,
and notifications over custom webviews or terminal-driven UI.

## UX Preferences

- Keep the tree visually quiet. Do not append status, agents, source, or other
  metadata to every skill label. Put detailed metadata in the Details view and
  tooltips.
- Use compact inline actions and semantic icons. Avoid long action labels when
  an icon is clear.
- Make wanted/unwanted and installed/missing independently visible and
  actionable.
- Keep Group By in one dropdown, mark the current choice, include short example
  values in menu labels, and distinguish group nodes with theme-aware icons.
- Do not add a separate toolbar action when an operation fits the overflow
  menu.
- Ask for input only when ambiguity matters, such as an install ID collision,
  selecting skills from a multi-skill repository, or confirming destructive
  cleanup.
- Run install, uninstall, and update operations in the background. Never open a
  VS Code terminal for them. Show progress and a completion or failure
  notification.
- Use GitHub owner avatars for GitHub repositories and their child skills.
- Ignore hidden skill directories such as `.system`; they may be runtime-owned.

## Domain Model

The persisted schema has two levels:

1. `SkillRepository` identifies a source repository and stores shared metadata
   plus discovered `availableSkills`.
2. `DeclaredSkill` represents one manageable skill instance.

`skillId` is the smallest identity and management unit. `repoId` is the stable
repository identity. `id` is the actual on-disk directory name and may differ
from `skillId` only when a supported flow explicitly resolves a collision.

A skill inherits `source`, `category`, and `wanted` from its repository when no
skill-level override exists. A skill override always wins. `sourceType` is
derived from the effective source. `scope` belongs to the skill instance.

Do not persist runtime installation state. Derive it by crossing effective
`wanted` with actual presence:

- `wanted-installed`
- `wanted-missing`
- `unwanted-installed`
- `unwanted-missing`
- `extra` for installed but undeclared skills

## Repository and Tree Behavior

- Group, filter, and sort by each skill's effective values.
- After filtering, regroup visible skills by `scope + repoId` for presentation.
- Show a repository parent only when the repository contains multiple skills.
  Render a single-skill repository directly as a skill item.
- Repository children remain independent skill records and actions operate on
  their `skillId`.
- Repository Update re-discovers available skills, offers only newly discovered
  skills for selection, installs selected additions, and updates installed
  children.
- Repository Delete uninstalls and removes all children in its intended scope.
- Deleting or un-wanting a source-less skill must warn that it cannot be
  automatically restored and offer explicit cleanup.

## Installation and Discovery

- Remote operations use `npx skills` through `execFile`, never a shell command
  string or integrated terminal.
- Batch remote installs by source and scope where the CLI supports it.
- Local sources are managed with symlinks.
- GitHub add flows discover repository skills with `skills add --list` and use
  a multi-select QuickPick.
- Recover repository source metadata from global and workspace skills lock
  files whenever possible.
- Preserve compatibility with schema migrations and hand-edited partial
  `data.json` files.

## Architecture

- `src/types.ts`: persisted and runtime domain types.
- `src/store.ts`: normalized, migrated, file-backed state.
- `src/scanner.ts`: global/project discovery and lock-file source recovery.
- `src/reconcile.ts`: inheritance and desired-versus-installed derivation.
- `src/provider.ts`: grouped repository/skill TreeView rendering.
- `src/detailsView.ts`: native Details TreeView.
- `src/commands.ts`: user workflows and state mutations.
- `src/installer.ts`: background install, uninstall, and update operations.
- `src/repositoryDiscovery.ts`: remote repository skill discovery.
- `src/source.ts`: source parsing, normalization, and repository identity.

Keep responsibilities within these boundaries. Avoid moving runtime state into
the store or mixing rendering logic into the installer.

## Development and Release

- Prefer focused TypeScript changes and reuse existing helpers.
- Use `rg` for search and `apply_patch` for edits.
- Do not add tests unless requested, but always run:

```sh
npm run typecheck
npm run build
git diff --check
```

- Before release, update `package.json`, `package-lock.json`, and
  `CHANGELOG.md`, then run `npm run package`.
- Keep `media/icon.png` as the Marketplace icon unless the product identity
  changes. It must remain a square PNG with sufficient resolution.
- Use Conventional Commit subjects. Do not push, tag, or publish unless the
  user explicitly requests it.
