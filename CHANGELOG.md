# Changelog

All notable changes to this project are documented in this file.

## [1.2.0] - 2026-07-28

### Changed

- Merged the standalone `agents.json` into `data.json` (`schemaVersion` 3). On
  first launch the legacy `agents.json` is folded into the new `agents` field
  and removed; a single `data.json` is now the complete portable state.
- Moved view state (`groupBy`, `groupRepositories`, `statusFilter`,
  `sortingOption`) out of `data.json` into in-memory state — only portable
  declared data is persisted; UI preferences reset each session.
- Dropped backward-compatibility scaffolding (legacy extension-id data copy,
  v1→v2 inline upgrade, `legacyRepositoryPlaceholder`, legacy `skills-manager`
  config section, and the `activeAgents` setup hint). Hand-edited or partial
  data files are still normalized defensively.
- Sorted `data.json` keys on write: scalars first (alphabetical), then
  arrays/objects, so heavy fields like `availableSkills` sink to the end.

### Added

- Local on-disk cache for GitHub owner avatars — tree icons load from disk
  after the first fetch instead of re-hitting `github.com` on every refresh.

## [1.1.0] - 2026-07-27

### Added

- Editable skill notes in the native Details view.
- Repository navigation that opens GitHub sources or local directories.
- Expand All and Collapse All toggles for the Skills and Agents trees.
- A bilingual Marketplace README with an animated product demo.

### Changed

- Focused skill discovery, installation, and Agent synchronization on the
  global library; project-local skill management is disabled for now.
- Simplified Agent configuration and Details by hiding project skill paths.
- Kept the large demo GIF in the source repository while excluding it from the
  runtime VSIX package.

## [1.0.2] - 2026-07-27

### Added

- Native Agents view with built-in and custom Agent configuration.
- Safe global and project skill synchronization through managed symlinks.
- Agent-owned, override, missing, and broken-link observations.
- First-run Agent detection with a preview-and-confirm workflow.
- Bundled product icons for built-in Agents, with muted variants for disabled
  Agents.
- Open Skills Directory actions for Agent and global library nodes.

### Changed

- Use `~/.agents/skills` and workspace `.agents/skills` as canonical libraries.
- Limit Scope grouping to enabled-Agent synchronization differences.
- Keep machine-specific Agent wiring in a separate `agents.json`.

## [1.0.1] - 2026-07-27

### Added

- Optional repository hierarchy toggle for switching between repository-grouped
  and direct skill views.
- Click-to-copy values in the Details view.

### Changed

- Simplified search results to prioritize source and compact wanted/installed
  status indicators.
- Added consistent wanted and installed emoji indicators to Details.
- Displayed added timestamps in the user's local timezone.

## [1.0.0] - 2026-07-27

### Added

- Declarative wanted-versus-installed reconciliation across supported Agent
  Skills directories.
- Repository and skill hierarchy with `skillId` as the smallest management
  unit.
- Multi-skill GitHub repository discovery and selective installation.
- Repository update, cascading delete, multi-selection, and context actions.
- Background install, uninstall, and update operations without opening a
  terminal.
- Native Details view, Group By dropdown, status actions, search, and
  theme-aware group visuals.
- GitHub owner avatars for repositories and child skills.
- Global and project scope scanning with lock-file source recovery.
- Schema migration for existing `data.json` files.
- Legacy global-storage migration from the pre-Marketplace extension ID.
- Apache License 2.0 and Marketplace icon.

### Changed

- Renamed the product and extension namespace to Skills Deck.
- Simplified tree labels to keep detailed metadata in the Details view.
- Ignored hidden runtime-owned skill directories such as `.system`.
- Prompted for install IDs only when collision resolution is required.
