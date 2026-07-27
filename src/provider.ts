/**
 * SkillsTreeProvider — the declarative skills tree.
 *
 * One generic grouping mechanism: `groupBy: GroupDimension` decides how root
 * nodes are bucketed via a single `bucketKey()` function. Adding a dimension
 * = adding a case in bucketKey, no provider surgery. Within each bucket,
 * skills are layered by status rank (diffs first) then user sorting.
 *
 * Ported structure from extensions-bookmark BookmarkDataProvider (300-468),
 * adapted to skills + the generic-group design.
 */

import * as vscode from 'vscode';
import { DecoratedSkill, GroupDimension, ScanResult, SkillScope, StatusFilter } from './types';
import { reconcile, isDiffStatus } from './reconcile';
import { read } from './store';
import { sortSkills, statusRank, STATUS_VISUALS } from './visuals';

/** A tree node. Leaf = a skill; branch = a group bucket. */
export class SkillNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: 'declaredSkill' | 'extraSkill' | 'group',
    public readonly skill?: DecoratedSkill,
    public readonly bucketKey?: string,
  ) {
    super(label, collapsibleState);
    if (skill) {
      this.id = `${skill.scope}:${skill.id}`;
      this.description = this.buildDescription(skill);
      this.iconPath = new vscode.ThemeIcon(STATUS_VISUALS[skill.status].codicon,
        new vscode.ThemeColor(STATUS_VISUALS[skill.status].color));
      this.tooltip = this.buildTooltip(skill);
    }
  }

  private buildDescription(s: DecoratedSkill): string {
    const v = STATUS_VISUALS[s.status];
    const agents = s.installedAgents.length ? s.installedAgents.join(', ') : '';
    return [v.desc, agents].filter(Boolean).join(' · ');
  }

  private buildTooltip(s: DecoratedSkill): vscode.MarkdownString {
    const v = STATUS_VISUALS[s.status];
    const lines = [
      `**${s.name}**`,
      `status: ${v.desc}${v.diff ? ' ★' : ''}`,
      `source: \`${s.source || '—'}\``,
      `scope: ${s.scope}`,
    ];
    if (s.installedAgents.length) { lines.push(`agents: ${s.installedAgents.join(', ')}`); }
    if (s.note) { lines.push(`note: ${s.note}`); }
    return new vscode.MarkdownString(lines.join('\n\n'));
  }
}

export class SkillsTreeProvider implements vscode.TreeDataProvider<SkillNode> {
  private _onDidChange = new vscode.EventEmitter<SkillNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private scan: ScanResult = { globalSkills: [], projectSkills: [] };
  private selectionId: string | undefined;

  setScan(scan: ScanResult): void {
    this.scan = scan;
    this.refresh();
  }

  refresh(keepSelection = true): void {
    this._onDidChange.fire(undefined);
    if (!keepSelection) { this.selectionId = undefined; }
  }

  /** Reveal a skill by id, used by Search. */
  setSelection(id: string): void {
    this.selectionId = id;
    this.refresh();
  }

  getTreeItem(element: SkillNode): SkillNode { return element; }

  getParent(): vscode.ProviderResult<SkillNode> { return null; }

  getChildren(element?: SkillNode): SkillNode[] {
    const state = read();
    const all = reconcile(state.skills, this.scan);
    const visible = this.applyFilter(all, state.statusFilter);
    const { groupBy } = state;

    if (!element) {
      // Root: bucket or flat.
      if (groupBy === 'flat') {
        return this.toNodes(sortSkills(visible, state.sortingOption));
      }
      return this.groupBuckets(visible, groupBy);
    }

    // Branch: children of a bucket.
    if (element.contextValue === 'group' && element.bucketKey !== undefined) {
      const inBucket = visible.filter(s => this.bucketKey(s, groupBy) === element.bucketKey);
      return this.toNodes(sortSkills(inBucket, state.sortingOption));
    }
    return [];
  }

  // ── grouping ──────────────────────────────────────────────────────────────

  /** Map a skill to its bucket key under the active dimension. */
  private bucketKey(s: DecoratedSkill, dim: GroupDimension): string {
    switch (dim) {
      case 'category': return s.category || 'Default';
      case 'source': return s.sourceType;
      case 'status': return this.statusBucket(s.status);
      case 'scope': return s.scope;
      case 'flat': return '';
    }
  }

  /** status dimension buckets skills into 3 fixed buckets. */
  private statusBucket(status: DecoratedSkill['status']): string {
    if (status === 'extra' || status === 'wanted-missing' || status === 'unwanted-installed') {
      return '__diff__';
    }
    return status === 'wanted-installed' ? '__wanted__' : '__unwanted__';
  }

  private groupBuckets(visible: DecoratedSkill[], dim: GroupDimension): SkillNode[] {
    const order = this.bucketOrder(dim);
    const byKey = new Map<string, DecoratedSkill[]>();
    for (const s of visible) {
      const k = this.bucketKey(s, dim);
      if (!byKey.has(k)) { byKey.set(k, []); }
      byKey.get(k)!.push(s);
    }

    const nodes: SkillNode[] = [];
    for (const key of order) {
      const items = byKey.get(key);
      if (!items || items.length === 0) { continue; }
      byKey.delete(key);
      const diffCount = items.filter(s => isDiffStatus(s.status)).length;
      const suffix = diffCount > 0 ? ` (${diffCount})` : ` (${items.length})`;
      nodes.push(new SkillNode(this.bucketLabel(dim, key) + suffix,
        vscode.TreeItemCollapsibleState.Expanded, 'group', undefined, key));
    }
    // Any keys not in the canonical order (e.g. user categories beyond Default).
    for (const [key, items] of byKey) {
      const suffix = ` (${items.length})`;
      nodes.push(new SkillNode(this.bucketLabel(dim, key) + suffix,
        vscode.TreeItemCollapsibleState.Expanded, 'group', undefined, key));
    }
    return nodes;
  }

  /** Canonical bucket ordering per dimension. */
  private bucketOrder(dim: GroupDimension): string[] {
    switch (dim) {
      case 'category': return ['Default'];
      case 'source': return ['github', 'local', 'marketplace', 'skillhub', 'unknown'];
      case 'status': return ['__wanted__', '__unwanted__', '__diff__'];
      case 'scope': return ['global', 'project'];
      case 'flat': return [];
    }
  }

  private bucketLabel(dim: GroupDimension, key: string): string {
    if (dim === 'status') {
      return key === '__wanted__' ? 'Wanted'
        : key === '__unwanted__' ? 'Not Wanted'
        : 'Diff';
    }
    if (dim === 'scope') {
      return key === 'global' ? 'Global' : 'Project';
    }
    if (dim === 'source') {
      return key.charAt(0).toUpperCase() + key.slice(1);
    }
    return key;
  }

  // ── filtering + node mapping ──────────────────────────────────────────────

  private applyFilter(list: DecoratedSkill[], filter: StatusFilter): DecoratedSkill[] {
    switch (filter) {
      case 'all': return list;
      case 'installed': return list.filter(s => s.installedAgents.length > 0);
      case 'unwanted': return list.filter(s => !s.wanted && !s.extra);
      case 'diff': return list.filter(s => isDiffStatus(s.status));
    }
  }

  private toNodes(skills: DecoratedSkill[]): SkillNode[] {
    return skills.map(s => new SkillNode(s.name, vscode.TreeItemCollapsibleState.None,
      s.extra ? 'extraSkill' : 'declaredSkill', s));
  }
}
