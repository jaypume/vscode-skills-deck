/**
 * Status visuals + sorting helpers, ported from extensions-bookmark's
 * STATUS_VISUALS / statusRank (extension.js:101-108, 401-407).
 */

import { DecoratedSkill, SkillStatus, SortingOption } from './types';

export interface StatusVisual {
  color: string;         // ThemeColor id, e.g. 'testing.iconPassed'
  desc: string;          // short inline label
  diff: boolean;         // ★ — diverges from declaration
}

export const STATUS_VISUALS: Record<SkillStatus, StatusVisual> = {
  'wanted-installed':   { color: 'testing.iconPassed', desc: 'installed', diff: false },
  'wanted-missing':     { color: 'testing.iconQueued', desc: 'not installed', diff: true },
  'unwanted-installed': { color: 'testing.iconFailed', desc: 'to remove', diff: true },
  'unwanted-missing':   { color: 'disabledForeground', desc: 'removed', diff: false },
  'extra':              { color: 'charts.blue', desc: 'undeclared', diff: true },
};

export function wantedEmoji(wanted: boolean): string {
  return wanted ? '⭐' : '🚫';
}

export function installedEmoji(installed: boolean): string {
  return installed ? '✅' : '❌';
}

/** Layered sort rank within a bucket: clean states first, diffs next, unwanted last. */
export function statusRank(s: SkillStatus): number {
  switch (s) {
    case 'wanted-installed': return 0;
    case 'wanted-missing': return 1;
    case 'extra': return 1;
    case 'unwanted-installed': return 2;
    case 'unwanted-missing': return 3;
  }
}

export function sortSkills(list: DecoratedSkill[], sorting: SortingOption): DecoratedSkill[] {
  const byName = (a: DecoratedSkill, b: DecoratedSkill) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  const byDateDesc = (a: DecoratedSkill, b: DecoratedSkill) =>
    (b.dateAdded || '').localeCompare(a.dateAdded || '');

  const copy = [...list];
  switch (sorting) {
    case 'A-Z': return copy.sort(byName);
    case 'Z-A': return copy.sort((a, b) => byName(b, a));
    case 'New-Old': return copy.sort(byDateDesc);
    case 'Old-New': return copy.sort((a, b) => byDateDesc(b, a));
  }
}
