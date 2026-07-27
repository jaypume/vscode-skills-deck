/**
 * Static registry of known AI coding agents and their skill directory paths.
 * Ported from skills-sh-plus. Paths verified against the skills.sh CLI source
 * (vercel-labs/skills/src/agents.ts).
 */

export interface KnownAgent {
  id: string;
  displayName: string;
  /** Skill directory relative to homedir (global) or workspace root (project). */
  skillsDir: string;
  /** Environment variable that overrides the base config directory. */
  envOverride?: string;
  /** True for the canonical ~/.agents/skills/ directory. */
  isCanonical?: boolean;
}

export const KNOWN_AGENTS: KnownAgent[] = [
  { id: 'canonical', displayName: 'skills.sh', skillsDir: '.agents/skills', isCanonical: true },
  { id: 'claude-code', displayName: 'Claude Code', skillsDir: '.claude/skills', envOverride: 'CLAUDE_CONFIG_DIR' },
  { id: 'cursor', displayName: 'Cursor', skillsDir: '.cursor/skills' },
  { id: 'windsurf', displayName: 'Windsurf', skillsDir: '.codeium/windsurf/skills' },
  { id: 'github-copilot', displayName: 'GitHub Copilot', skillsDir: '.copilot/skills' },
  { id: 'codex', displayName: 'Codex', skillsDir: '.codex/skills', envOverride: 'CODEX_HOME' },
  { id: 'roo', displayName: 'Roo Code', skillsDir: '.roo/skills' },
  { id: 'gemini-cli', displayName: 'Gemini CLI', skillsDir: '.gemini/skills' },
  { id: 'trae', displayName: 'Trae', skillsDir: '.trae/skills' },
  { id: 'kiro', displayName: 'Kiro', skillsDir: '.kiro/skills' },
  { id: 'continue', displayName: 'Continue', skillsDir: '.continue/skills' },
];

export const ALL_AGENT_IDS = KNOWN_AGENTS.map(a => a.id);
