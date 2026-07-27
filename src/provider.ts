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
import {
  DecoratedSkill,
  GroupDimension,
  ScanResult,
  SkillRepository,
  SkillScope,
  StatusFilter,
} from './types';
import { reconcile, isDiffStatus } from './reconcile';
import { read } from './store';
import * as viewState from './viewState';
import * as avatarCache from './avatarCache';
import { sortSkills, statusRank, STATUS_VISUALS } from './visuals';
import { parseSource } from './source';

type SkillNodeContext =
  | `declaredSkill.${'wanted' | 'unwanted'}.${'installed' | 'missing'}`
  | 'extraSkill.unwanted.installed'
  | 'repository'
  | 'group'
  | 'placeholder';

/** A tree node. Leaf = a skill; branch = a group bucket. */
export class SkillNode extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: SkillNodeContext,
    public readonly skill?: DecoratedSkill,
    public readonly bucketKey?: string,
    public readonly repository?: SkillRepository,
    public readonly repositorySkills?: DecoratedSkill[],
  ) {
    super(label, collapsibleState);
    if (skill) {
      this.id = `${skill.scope}:${skill.repoId}:${skill.skillId}`;
      this.tooltip = this.buildTooltip(skill);
    }
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

  private scan: ScanResult = {
    globalSkills: [],
    projectSkills: [],
    agentSkills: [],
    agents: [],
  };
  private selectionId: string | undefined;

  constructor() {
    // Refresh once when a GitHub avatar finishes downloading in the background,
    // so a placeholder icon is swapped for the real avatar.
    avatarCache.onReady(() => this.refresh());
  }

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
    const all = reconcile(state.skills, state.repositories, this.scan)
      .filter(skill => skill.scope === 'global');
    const groupBy = viewState.get('groupBy');
    const filtered = this.applyFilter(all, viewState.get('statusFilter'));
    const visible = groupBy === 'scope'
      ? filtered.filter(skill => skill.hasAgentDiff)
      : filtered;

    if (!element) {
      if (groupBy === 'scope' && visible.length === 0) {
        const node = new SkillNode(
          this.scan.agents.some(agent => agent.enabled)
            ? 'No Agent sync differences'
            : 'No enabled Agents',
          vscode.TreeItemCollapsibleState.None,
          'placeholder',
        );
        node.iconPath = new vscode.ThemeIcon('info');
        return [node];
      }
      // Root: bucket or flat.
      if (groupBy === 'flat') {
        return this.renderSkills(
          sortSkills(visible, viewState.get('sortingOption')),
          all,
          'flat',
          viewState.get('groupRepositories'),
        );
      }
      return this.groupBuckets(visible, groupBy);
    }

    // Branch: children of a bucket.
    if (element.contextValue === 'group' && element.bucketKey !== undefined) {
      const inBucket = visible.filter(s => this.bucketKey(s, groupBy) === element.bucketKey);
      return this.renderSkills(
        sortSkills(inBucket, viewState.get('sortingOption')),
        all,
        `${groupBy}:${element.bucketKey}`,
        viewState.get('groupRepositories'),
      );
    }
    if (element.contextValue === 'repository') {
      return this.toSkillNodes(element.repositorySkills ?? []);
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
      nodes.push(this.toGroupNode(
        dim,
        key,
        diffCount > 0 ? diffCount : items.length,
      ));
    }
    // Any keys not in the canonical order (e.g. user categories beyond Default).
    for (const [key, items] of byKey) {
      nodes.push(this.toGroupNode(dim, key, items.length));
    }
    return nodes;
  }

  private toGroupNode(dim: GroupDimension, key: string, count: number): SkillNode {
    const node = new SkillNode(
      this.bucketLabel(dim, key),
      vscode.TreeItemCollapsibleState.Expanded,
      'group',
      undefined,
      key,
    );
    node.description = `${count}`;
    node.iconPath = groupIcon(dim, key);
    return node;
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
      case 'installed': return list.filter(s => s.installed);
      case 'unwanted': return list.filter(s => !s.wanted && !s.extra);
      case 'diff': return list.filter(s => isDiffStatus(s.status));
    }
  }

  private renderSkills(
    skills: DecoratedSkill[],
    all: DecoratedSkill[],
    parentKey: string,
    groupRepositories: boolean,
  ): SkillNode[] {
    if (!groupRepositories) { return this.toSkillNodes(skills); }

    const totalByRepository = new Map<string, number>();
    for (const skill of all) {
      const key = repositoryKey(skill);
      totalByRepository.set(key, (totalByRepository.get(key) ?? 0) + 1);
    }

    const visibleByRepository = new Map<string, DecoratedSkill[]>();
    for (const skill of skills) {
      const key = repositoryKey(skill);
      const items = visibleByRepository.get(key) ?? [];
      items.push(skill);
      visibleByRepository.set(key, items);
    }

    const nodes: SkillNode[] = [];
    const renderedRepositories = new Set<string>();
    for (const skill of skills) {
      const key = repositoryKey(skill);
      if (renderedRepositories.has(key)) { continue; }
      renderedRepositories.add(key);
      const repositorySkills = visibleByRepository.get(key) ?? [skill];
      const availableCount = skill.repository.availableSkills?.length ?? 0;
      const isMultiSkill = Math.max(totalByRepository.get(key) ?? 0, availableCount) > 1;
      if (!isMultiSkill) {
        nodes.push(this.toSkillNode(skill));
        continue;
      }

      const node = new SkillNode(
        `${skill.repository.name} (${repositorySkills.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'repository',
        undefined,
        undefined,
        skill.repository,
        repositorySkills,
      );
      node.id = `repository:${parentKey}:${key}`;
      node.iconPath = sourceIcon(skill.sourceType, skill.source);
      const repositorySource = skill.repository.source || skill.source;
      node.tooltip = new vscode.MarkdownString(
        `**${skill.repository.name}**\n\nsource: \`${repositorySource || '—'}\`\n\n`
        + `${repositorySkills.length} visible skill(s)\n\nClick to open repository`,
      );
      const repositoryType = parseSource(repositorySource).type;
      if (repositoryType === 'github' || repositoryType === 'local') {
        node.command = {
          command: 'skillsDeck.openRepository',
          title: 'Open Repository',
          arguments: [repositorySource, skill.repository.name],
        };
      }
      nodes.push(node);
    }
    return nodes;
  }

  private toSkillNodes(skills: DecoratedSkill[]): SkillNode[] {
    return skills.map(skill => this.toSkillNode(skill));
  }

  private toSkillNode(s: DecoratedSkill): SkillNode {
    const installed = s.installed;
    const actual = installed ? 'installed' : 'missing';
    const contextValue: SkillNodeContext = s.extra
      ? 'extraSkill.unwanted.installed'
      : `declaredSkill.${s.wanted ? 'wanted' : 'unwanted'}.${actual}`;
    const node = new SkillNode(
      s.name,
      vscode.TreeItemCollapsibleState.None,
      contextValue,
      s,
    );
    node.iconPath = sourceIcon(s.sourceType, s.source);
    return node;
  }

}

function repositoryKey(skill: DecoratedSkill): string {
  return `${skill.scope}:${skill.repoId}`;
}

function groupIcon(dim: GroupDimension, key: string): vscode.ThemeIcon {
  if (dim === 'status') {
    if (key === '__wanted__') {
      return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
    }
    if (key === '__unwanted__') {
      return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'));
    }
    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
  }
  if (dim === 'source') {
    return new vscode.ThemeIcon('repo', new vscode.ThemeColor('charts.blue'));
  }
  if (dim === 'scope') {
    const icon = key === 'global' ? 'globe' : 'root-folder';
    return new vscode.ThemeIcon(icon, new vscode.ThemeColor('charts.green'));
  }
  return new vscode.ThemeIcon('tag', new vscode.ThemeColor('charts.purple'));
}

function sourceIcon(
  sourceType: DecoratedSkill['sourceType'],
  source: string,
): vscode.Uri | vscode.ThemeIcon {
  if (sourceType === 'github') {
    const owner = githubOwner(source);
    if (owner) {
      return avatarCache.getAvatar(owner) ?? new vscode.ThemeIcon('github');
    }
    return new vscode.ThemeIcon('github');
  }
  switch (sourceType) {
    case 'local': return new vscode.ThemeIcon('folder');
    case 'marketplace':
    case 'skillhub': return new vscode.ThemeIcon('globe');
    case 'unknown': return new vscode.ThemeIcon('question');
  }
}

function githubOwner(source: string): string | undefined {
  const { spec } = parseSource(source);
  const match = spec.trim().match(
    /^(?:https?:\/\/github\.com\/|git@github\.com:)?([^/\s]+)\/[^/\s#]+/i,
  );
  return match?.[1];
}
