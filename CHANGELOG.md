# Changelog

All notable changes to this project are documented in this file.

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
