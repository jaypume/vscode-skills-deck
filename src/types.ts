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

export interface BuiltInAgent {
  id: string;
  displayName: string;
  rootDir: string;
  globalSkillsDir: string;
  projectSkillsDir: string;
  rootEnv?: string;
  rootEnvSuffix?: string;
  globalSkillsEnv?: string;
  globalSkillsEnvSuffix?: string;
}

export interface AgentPreference {
  id: string;
  enabled: boolean;
  rootDir?: string;
  globalSkillsDir?: string;
  projectSkillsDir?: string;
}

export interface CustomAgent {
  id: string;
  displayName: string;
  rootDir: string;
  globalSkillsDir: string;
  projectSkillsDir: string;
  enabled: boolean;
}

/** @deprecated kept for reading legacy `agents.json` during migration. */
export interface AgentsState {
  schemaVersion: 1;
  setupCompleted: boolean;
  preferences: AgentPreference[];
  customAgents: CustomAgent[];
}

/** Agent payload merged into `SkillsState.agents` (no own schemaVersion). */
export interface AgentsPayload {
  setupCompleted: boolean;
  preferences: AgentPreference[];
  customAgents: CustomAgent[];
}

export interface ResolvedAgent {
  id: string;
  displayName: string;
  rootDir: string;
  globalSkillsDir: string;
  projectSkillsDir: string;
  enabled: boolean;
  custom: boolean;
  detected: boolean;
}

export type AgentSkillState =
  | 'managed-link'
  | 'missing'
  | 'agent-owned'
  | 'override'
  | 'broken-link';

export interface AgentSkillObservation {
  agentId: string;
  agentName: string;
  enabled: boolean;
  scope: SkillScope;
  skillId: string;
  name: string;
  path: string;
  state: AgentSkillState;
  centralPath?: string;
  linkTarget?: string;
}

export interface RepositorySkill {
  skillId: string;
  name: string;
  description?: string;
}

/** Shared source metadata and defaults inherited by child skills. */
export interface SkillRepository {
  repoId: string;
  name: string;
  source?: string;
  category?: string;
  wanted?: boolean;
  dateAdded: string;
  availableSkills?: RepositorySkill[];
}

/**
 * A skill the user declared. Corresponds to extensions-bookmark's `Bookmark`.
 * Optional fields override repository defaults when present.
 */
export interface DeclaredSkill {
  /** Actual on-disk folder name. */
  id: string;
  /** Stable skill identity within its source repository. */
  skillId: string;
  /** Parent repository/source identity. */
  repoId: string;
  /** Display name (from SKILL.md frontmatter, or falls back to id). */
  name: string;
  /** Per-skill source override. */
  source?: string;
  /** Per-skill category override. */
  category?: string;
  /** Per-skill wanted override. */
  wanted?: boolean;
  /** ISO date string, for chronological sorting. */
  dateAdded: string;
  scope: SkillScope;
  note?: string;
}

/** Top-level persisted state. Single source of truth (data.json). */
export interface SkillsState {
  schemaVersion: 3;
  repositories: SkillRepository[];
  skills: DeclaredSkill[];
  categories: string[];
  agents: AgentsPayload;
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
  observations: AgentSkillObservation[];
  /** Lock-file source if available (informational). */
  source?: string;
}

export interface ScanResult {
  globalSkills: InstalledSkill[];
  projectSkills: InstalledSkill[];
  agentSkills: AgentSkillObservation[];
  agents: ResolvedAgent[];
}

/** A declaration with repository defaults resolved. */
export interface ResolvedSkill extends DeclaredSkill {
  source: string;
  category: string;
  wanted: boolean;
  repository: SkillRepository;
}

/** A declared skill augmented with reconciled runtime state. */
export interface DecoratedSkill extends ResolvedSkill {
  status: SkillStatus;
  sourceType: SourceType;
  installed: boolean;
  /** Agents where this skill is actually installed. Empty when missing. */
  installedAgents: string[];
  missingAgents: string[];
  overrideAgents: string[];
  brokenAgents: string[];
  hasAgentDiff: boolean;
  /** On-disk path (from scan) when installed. */
  installedPath?: string;
  /** True for undeclared-but-installed pseudo entries. */
  extra?: boolean;
}
