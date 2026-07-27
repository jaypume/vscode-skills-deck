/**
 * Core data model for the declarative skills manager.
 *
 * Persistence shape (data.json) lives in `SkillsState` / `DeclaredSkill`.
 * Runtime-only decorations (`DecoratedSkill`, `SkillStatus`) are computed at
 * render time and never persisted — the heart of the declarative model.
 */

/** Installation scope. */
export type SkillScope = 'global' | 'project';

/** Where a declared skill comes from. */
export type SourceType = 'github' | 'local' | 'marketplace' | 'skillhub' | 'unknown';

/** Tree grouping dimension — one mechanism covers all grouping needs. */
export type GroupDimension = 'category' | 'source' | 'status' | 'scope' | 'flat';

/** Status filter applied on top of grouping. */
export type StatusFilter = 'all' | 'installed' | 'unwanted' | 'diff';

export type SortingOption = 'A-Z' | 'Z-A' | 'New-Old' | 'Old-New';

/**
 * A skill the user declared. Corresponds to extensions-bookmark's `Bookmark`.
 * `wanted` is the declarative field; actual install state is reconciled later.
 */
export interface DeclaredSkill {
  /** Stable key, lowercase-kebab, equals the on-disk folder name. */
  id: string;
  /** Display name (from SKILL.md frontmatter, or falls back to id). */
  name: string;
  /** Normalized source string, e.g. `github:owner/repo`, `local:/abs/path`. */
  source: string;
  /** User category; defaults to 'Default'. */
  category: string;
  /** true = want it installed, false = want it removed. */
  wanted: boolean;
  /** ISO date string, for chronological sorting. */
  dateAdded: string;
  scope: SkillScope;
  note?: string;
}

/** Top-level persisted state. Mirrors extensions-bookmark store DEFAULTS. */
export interface SkillsState {
  skills: DeclaredSkill[];
  categories: string[];
  groupBy: GroupDimension;
  statusFilter: StatusFilter;
  sortingOption: SortingOption;
}

/**
 * Runtime decoration layered onto a declared (or extra) skill.
 * `status` is derived from `wanted` × actual install presence.
 *
 * wanted × installed four-quadrant + one `extra` (installed but undeclared).
 * Diff statuses are marked ★.
 */
export type SkillStatus =
  | 'wanted-installed'    // wanted  + installed  ✓
  | 'wanted-missing'      // wanted  + missing    ★ diff
  | 'unwanted-installed'  // unwanted + installed ★ diff
  | 'unwanted-missing'    // unwanted + missing   ✓
  | 'extra';              // undeclared + installed ★ diff

/** An installed skill as discovered by the scanner (subset of skills-sh-plus). */
export interface InstalledSkill {
  folderName: string;
  name: string;
  description?: string;
  path: string;
  scope: SkillScope;
  /** Agents whose skill dirs contain this folderName. */
  agents: string[];
  /** Lock-file source if available (informational). */
  source?: string;
}

export interface ScanResult {
  globalSkills: InstalledSkill[];
  projectSkills: InstalledSkill[];
}

/** A declared skill augmented with reconciled runtime state. */
export interface DecoratedSkill extends DeclaredSkill {
  status: SkillStatus;
  sourceType: SourceType;
  /** Agents where this skill is actually installed. Empty when missing. */
  installedAgents: string[];
  /** On-disk path (from scan) when installed. */
  installedPath?: string;
  /** True for undeclared-but-installed pseudo entries. */
  extra?: boolean;
}
