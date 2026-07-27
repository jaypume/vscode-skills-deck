import * as vscode from 'vscode';
import * as agentStore from './agentStore';
import {
  AgentSkillObservation,
  ResolvedAgent,
  ScanResult,
} from './types';
import { centralSkillsDir, compactPath } from './known-agents';

type AgentNodeKind = 'library' | 'group' | 'agent' | 'skill';

export class AgentNode extends vscode.TreeItem {
  constructor(
    public readonly kind: AgentNodeKind,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly agent?: ResolvedAgent,
    public readonly observation?: AgentSkillObservation,
    public readonly enabledGroup?: boolean,
  ) {
    super(label, collapsibleState);
  }
}

export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentNode> {
  private readonly changeEmitter = new vscode.EventEmitter<AgentNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private scan: ScanResult = {
    globalSkills: [],
    projectSkills: [],
    agentSkills: [],
    agents: [],
  };

  constructor(private readonly extensionUri: vscode.Uri) {}

  setScan(scan: ScanResult): void {
    this.scan = scan;
    this.refresh();
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: AgentNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentNode): AgentNode[] {
    if (!element) {
      return [
        this.libraryNode(),
        this.groupNode(true),
        this.groupNode(false),
      ];
    }
    if (element.kind === 'group') {
      return agentStore.resolved()
        .filter(agent => agent.enabled === element.enabledGroup)
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
        .map(agent => this.agentNode(agent));
    }
    if (element.kind === 'agent' && element.agent) {
      return this.scan.agentSkills
        .filter(item => item.agentId === element.agent!.id)
        .sort(compareObservations)
        .map(item => this.skillNode(item, element.agent!));
    }
    return [];
  }

  private libraryNode(): AgentNode {
    const root = centralSkillsDir('global')!;
    const node = new AgentNode(
      'library',
      'Global Library',
      vscode.TreeItemCollapsibleState.None,
    );
    node.id = 'agent-library';
    node.contextValue = 'agents.library';
    node.description = compactPath(pathParent(root));
    node.tooltip = `Central skills: ${compactPath(root)}`;
    node.iconPath = new vscode.ThemeIcon('library');
    return node;
  }

  private groupNode(enabled: boolean): AgentNode {
    const count = agentStore.resolved().filter(agent => agent.enabled === enabled).length;
    const node = new AgentNode(
      'group',
      enabled ? 'Enabled' : 'Disabled',
      vscode.TreeItemCollapsibleState.Expanded,
      undefined,
      undefined,
      enabled,
    );
    node.id = `agent-group:${enabled ? 'enabled' : 'disabled'}`;
    node.contextValue = 'agents.group';
    node.description = `${count}`;
    node.iconPath = new vscode.ThemeIcon(enabled ? 'pass-filled' : 'circle-slash');
    return node;
  }

  private agentNode(agent: ResolvedAgent): AgentNode {
    const issues = this.scan.agentSkills.filter(item => item.agentId === agent.id).length;
    const node = new AgentNode(
      'agent',
      agent.displayName,
      issues > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      agent,
    );
    node.id = `agent:${agent.id}`;
    node.contextValue = [
      'agents.agent',
      agent.enabled ? 'enabled' : 'disabled',
      agent.custom ? 'custom' : 'builtin',
    ].join('.');
    node.description = compactPath(agent.rootDir);
    node.iconPath = agent.custom
      ? new vscode.ThemeIcon(
        'robot',
        new vscode.ThemeColor(agent.enabled ? 'testing.iconPassed' : 'disabledForeground'),
      )
      : vscode.Uri.joinPath(
        this.extensionUri,
        'media',
        'agents',
        `${agent.id}${agent.enabled ? '' : '-disabled'}.png`,
      );
    node.tooltip = new vscode.MarkdownString([
      `**${agent.displayName}**`,
      `ID: \`${agent.id}\``,
      `Parent: \`${compactPath(agent.rootDir)}\``,
      `Global skills: \`${compactPath(agent.globalSkillsDir)}\``,
      `Detected: ${agent.detected ? 'yes' : 'no'}`,
      `Sync issues: ${issues}`,
    ].join('\n\n'));
    return node;
  }

  private skillNode(
    observation: AgentSkillObservation,
    agent: ResolvedAgent,
  ): AgentNode {
    const node = new AgentNode(
      'skill',
      observation.name,
      vscode.TreeItemCollapsibleState.None,
      agent,
      observation,
    );
    node.id = `agent-skill:${agent.id}:${observation.scope}:${observation.skillId}`;
    node.contextValue = `agents.skill.${observation.state}`;
    node.description = `${observation.scope} · ${stateLabel(observation.state)}`;
    node.iconPath = stateIcon(observation.state);
    node.tooltip = `${stateLabel(observation.state)}\n${compactPath(observation.path)}`;
    return node;
  }
}

function compareObservations(
  left: AgentSkillObservation,
  right: AgentSkillObservation,
): number {
  return stateRank(left.state) - stateRank(right.state)
    || left.name.localeCompare(right.name);
}

function stateRank(state: AgentSkillObservation['state']): number {
  switch (state) {
    case 'broken-link': return 0;
    case 'missing': return 1;
    case 'override': return 2;
    case 'agent-owned': return 3;
    case 'managed-link': return 4;
  }
}

function stateLabel(state: AgentSkillObservation['state']): string {
  switch (state) {
    case 'managed-link': return 'managed';
    case 'missing': return 'missing';
    case 'agent-owned': return 'agent owned';
    case 'override': return 'override';
    case 'broken-link': return 'broken link';
  }
}

function stateIcon(state: AgentSkillObservation['state']): vscode.ThemeIcon {
  switch (state) {
    case 'managed-link': return new vscode.ThemeIcon('link');
    case 'missing': return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    case 'agent-owned': return new vscode.ThemeIcon('file-directory');
    case 'override': return new vscode.ThemeIcon('shield');
    case 'broken-link': return new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('list.errorForeground'));
  }
}

function pathParent(value: string): string {
  return value.replace(/[\\/]skills[\\/]?$/, '');
}
