import * as path from 'path';
import * as vscode from 'vscode';
import {
  DeclaredSkill,
  DecoratedSkill,
  GroupDimension,
  RepositorySkill,
  ResolvedSkill,
  SkillRepository,
  SkillsState,
  SkillScope,
  StatusFilter,
} from './types';
import * as store from './store';
import {
  classifySource,
  localPath,
  normalizeSource,
  parseNpxCommand,
  repositoryId,
  repositoryName,
} from './source';
import { SkillScanner } from './scanner';
import { SkillNode, SkillsTreeProvider } from './provider';
import { installSkills, uninstallSkills, updateSkills } from './installer';
import { reconcile, resolveDeclaredSkill } from './reconcile';
import { discoverRepositorySkills } from './repositoryDiscovery';

export interface CommandDeps {
  scanner: SkillScanner;
  provider: SkillsTreeProvider;
  rescan: () => Promise<void>;
}

type SourceTypeLabel = 'GitHub' | 'skills.sh' | 'skillhub.cn' | 'Local';

interface SourceInput {
  source: string;
  defaultId: string;
  requestedSkill?: string;
}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const { provider, rescan } = deps;
  const subs: vscode.Disposable[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const push = (command: string, fn: (...args: any[]) => unknown) =>
    subs.push(vscode.commands.registerCommand(command, fn));

  push('skillsManager.addSkill', async () => {
    const picked = await vscode.window.showQuickPick(
      [
        { label: '$(github) GitHub', type: 'GitHub' as SourceTypeLabel, detail: '从 GitHub 仓库选择并安装 skills' },
        { label: '$(package) skills.sh', type: 'skills.sh' as SourceTypeLabel, detail: '粘贴 npx skills add 命令' },
        { label: '$(link) skillhub.cn', type: 'skillhub.cn' as SourceTypeLabel, detail: '粘贴 skillhub.cn 详情页链接' },
        { label: '$(folder) Local', type: 'Local' as SourceTypeLabel, detail: '指向本地 skill 目录' },
      ],
      { placeHolder: '选择 skill 源类型', title: 'Add Skill — 源类型' },
    );
    if (!picked) { return; }
    const input = await collectSourceInput(picked.type);
    if (!input) { return; }
    const scope = await pickScope();
    if (!scope) { return; }

    let discovered: RepositorySkill[];
    if (classifySource(input.source) === 'github') {
      try {
        discovered = await discoverRepositorySkills(input.source);
      } catch (error) {
        vscode.window.showErrorMessage(`无法读取仓库 skills：${errorMessage(error)}`);
        return;
      }
    } else {
      discovered = [{ skillId: input.requestedSkill ?? input.defaultId, name: input.defaultId }];
    }

    const state = store.read();
    const repoId = repositoryId(input.source, `${scope}:${input.defaultId}`);
    const existingIds = new Set(
      state.skills
        .filter(skill => skill.repoId === repoId && skill.scope === scope)
        .map(skill => skill.skillId),
    );
    const choices = discovered.map(skill => ({
      label: skill.name,
      description: skill.skillId === skill.name ? undefined : skill.skillId,
      detail: skill.description,
      skill,
      picked: existingIds.has(skill.skillId)
        || skill.skillId === input.requestedSkill
        || discovered.length === 1,
    }));
    const selected = await vscode.window.showQuickPick(choices, {
      canPickMany: true,
      title: `Select Skills — ${repositoryName(repoId, input.defaultId)}`,
      placeHolder: '选择要收藏的 skills',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!selected || selected.length === 0) { return; }

    const repository = upsertRepository(state, {
      repoId,
      name: repositoryName(repoId, input.defaultId),
      source: input.source,
      category: 'Default',
      wanted: true,
      dateAdded: new Date().toISOString(),
      availableSkills: discovered,
    });
    const added: DeclaredSkill[] = [];
    for (const choice of selected) {
      if (existingIds.has(choice.skill.skillId)) { continue; }
      const collision = state.skills.find(skill =>
        skill.scope === scope && skill.id === choice.skill.skillId);
      if (collision) {
        vscode.window.showErrorMessage(
          `无法添加 "${choice.skill.skillId}"：${scope} scope 已被仓库 `
          + `"${repositoryName(collision.repoId, collision.repoId)}" 使用。`,
        );
        continue;
      }
      const id = classifySource(input.source) === 'local'
        ? await resolveInstallId(choice.skill.skillId, scope, state.skills)
        : choice.skill.skillId;
      if (!id) { continue; }
      const declaration: DeclaredSkill = {
        id,
        skillId: choice.skill.skillId,
        repoId: repository.repoId,
        name: choice.skill.name,
        dateAdded: new Date().toISOString(),
        scope,
      };
      state.skills.push(declaration);
      added.push(declaration);
    }
    store.write(state);
    await rescan();
    if (added.length === 0) {
      vscode.window.showInformationMessage('所选 skills 已在列表中。');
      return;
    }

    const action = await vscode.window.showInformationMessage(
      `已添加 ${added.length} 个 skill。立即安装？`,
      '安装',
    );
    if (action === '安装') {
      await installSkills(added.map(skill => resolveDeclaredSkill(skill, state.repositories)));
      await rescan();
    }
  });

  push('skillsManager.removeSkill', async (
    node?: SkillNode,
    selection?: readonly SkillNode[],
  ) => {
    const nodes = selectedSkillNodes(node, selection).filter(item => !item.skill!.extra);
    if (nodes.length === 0) { return; }
    if (nodes.length > 1) {
      const action = await vscode.window.showWarningMessage(
        `从列表移除 ${nodes.length} 个 skill？已安装内容不会被卸载。`,
        '移除',
      );
      if (action !== '移除') { return; }
    }
    const keys = new Set(nodes.map(skillKey));
    const state = store.read();
    state.skills = state.skills.filter(skill => !keys.has(declarationKey(skill)));
    store.write(state);
    await rescan();
  });

  push('skillsManager.updateRepository', async (node?: SkillNode) => {
    const repository = node?.repository;
    const scope = node?.repositorySkills?.[0]?.scope;
    if (!repository || !scope) { return; }
    if (!repository.source || classifySource(repository.source) !== 'github') {
      vscode.window.showErrorMessage(`仓库 "${repository.name}" 没有可更新的 GitHub Source。`);
      return;
    }

    let discovered: RepositorySkill[];
    try {
      discovered = await discoverRepositorySkills(repository.source);
    } catch (error) {
      vscode.window.showErrorMessage(`无法更新仓库 skills：${errorMessage(error)}`);
      return;
    }

    const state = store.read();
    const storedRepository = upsertRepository(state, {
      ...repository,
      availableSkills: discovered,
    });
    const existingIds = new Set(
      state.skills
        .filter(skill => skill.repoId === repository.repoId && skill.scope === scope)
        .map(skill => skill.skillId),
    );
    const additions = discovered.filter(skill => !existingIds.has(skill.skillId));
    let selected: RepositorySkill[] = [];
    if (additions.length > 0) {
      const picked = await vscode.window.showQuickPick(
        additions.map(skill => ({
          label: skill.name,
          description: skill.skillId === skill.name ? undefined : skill.skillId,
          detail: skill.description,
          skill,
        })),
        {
          canPickMany: true,
          title: `New Skills — ${repository.name}`,
          placeHolder: '选择要添加并安装的新 skills；不选择则只更新现有 skills',
          matchOnDescription: true,
          matchOnDetail: true,
        },
      );
      selected = picked?.map(item => item.skill) ?? [];
    }

    const added: DeclaredSkill[] = [];
    for (const skill of selected) {
      const collision = state.skills.find(item =>
        item.scope === scope && item.id === skill.skillId);
      if (collision) {
        vscode.window.showErrorMessage(
          `无法添加 "${skill.skillId}"：${scope} scope 已被仓库 `
          + `"${repositoryName(collision.repoId, collision.repoId)}" 使用。`,
        );
        continue;
      }
      const declaration: DeclaredSkill = {
        id: skill.skillId,
        skillId: skill.skillId,
        repoId: repository.repoId,
        name: skill.name,
        wanted: storedRepository.wanted === false ? true : undefined,
        dateAdded: new Date().toISOString(),
        scope,
      };
      state.skills.push(declaration);
      added.push(declaration);
    }

    store.write(state);
    const current = reconcile(state.skills, state.repositories, await deps.scanner.scan());
    const installed = current.filter(skill =>
      skill.repoId === repository.repoId
      && skill.scope === scope
      && skill.installedAgents.length > 0
      && !added.some(item => item.skillId === skill.skillId));

    await updateSkills(installed);
    await installSkills(added.map(skill => resolveDeclaredSkill(skill, state.repositories)));
    await rescan();
    if (installed.length === 0 && added.length === 0) {
      const detail = additions.length > 0
        ? '未选择新增 skill，现有 skill 也尚未安装。'
        : '没有发现新增 skill，现有 skill 也尚未安装。';
      vscode.window.showInformationMessage(`仓库 "${repository.name}" 已检查。${detail}`);
    }
  });

  push('skillsManager.removeRepository', async (node?: SkillNode) => {
    const repository = node?.repository;
    if (!repository) { return; }
    const state = store.read();
    const all = reconcile(state.skills, state.repositories, await deps.scanner.scan());
    const children = all.filter(skill => skill.repoId === repository.repoId);
    const installed = children.filter(skill => skill.installedAgents.length > 0);
    const action = await vscode.window.showWarningMessage(
      `删除仓库 "${repository.name}"？将卸载 ${installed.length} 个已安装 skill，`
      + `并删除其下 ${children.length} 个 skill。`,
      { modal: true },
      '删除仓库',
    );
    if (action !== '删除仓库') { return; }

    await uninstallSkills(installed);
    state.skills = state.skills.filter(skill => skill.repoId !== repository.repoId);
    state.repositories = state.repositories.filter(repo => repo.repoId !== repository.repoId);
    store.write(state);
    await rescan();
  });

  push('skillsManager.editSkill', async (node?: SkillNode) => {
    const current = node?.skill;
    if (!current || current.extra) { return; }
    const state = store.read();
    const declaration = findDeclaration(state.skills, current);
    if (!declaration) { return; }
    const category = await vscode.window.showInputBox({
      prompt: 'category',
      value: current.category,
    });
    if (category === undefined) { return; }
    const note = await vscode.window.showInputBox({
      prompt: 'note',
      value: declaration.note ?? '',
    });
    if (note === undefined) { return; }

    const repository = repositoryFor(state, declaration);
    const value = category.trim() || 'Default';
    declaration.category = value === (repository.category ?? 'Default') ? undefined : value;
    declaration.note = note.trim() || undefined;
    store.write(state);
    await rescan();
  });

  push('skillsManager.toggleWanted', async (
    node?: SkillNode,
    selection?: readonly SkillNode[],
  ) => {
    const nodes = selectedSkillNodes(node, selection);
    if (nodes.length === 0) { return; }
    const state = store.read();
    const sourceLess = nodes.filter(item => {
      const skill = item.skill!;
      if (skill.extra) { return false; }
      return !hasSource(skill) && (skill.wanted || skill.installedAgents.length === 0);
    });
    if (sourceLess.length > 0 && !(await confirmSourceLessCleanup(sourceLess))) { return; }

    const cleanupKeys = new Set(sourceLess.map(skillKey));
    const toInstall: ResolvedSkill[] = [];
    const toUninstall: ResolvedSkill[] = [];
    for (const selected of nodes) {
      const current = selected.skill!;
      const key = skillKey(selected);
      if (cleanupKeys.has(key)) {
        if (current.installedAgents.length > 0) { toUninstall.push(current); }
        continue;
      }
      if (current.extra) {
        upsertRepository(state, {
          ...current.repository,
          source: current.source,
          wanted: true,
        });
        state.skills.push({
          id: current.id,
          skillId: current.skillId,
          repoId: current.repoId,
          name: current.name,
          dateAdded: new Date().toISOString(),
          scope: current.scope,
        });
        continue;
      }
      const declaration = findDeclaration(state.skills, current);
      if (!declaration) { continue; }
      const desired = !current.wanted;
      setWantedOverride(declaration, repositoryFor(state, declaration), desired);
      if (desired && current.status === 'unwanted-missing') {
        toInstall.push({ ...current, wanted: true });
      } else if (!desired && current.status === 'wanted-installed') {
        toUninstall.push({ ...current, wanted: false });
      }
    }

    if (cleanupKeys.size > 0) {
      state.skills = state.skills.filter(skill => !cleanupKeys.has(declarationKey(skill)));
    }
    store.write(state);
    await uninstallSkills(toUninstall);
    await installSkills(toInstall);
    await rescan();
  });

  push('skillsManager.refresh', async () => { await rescan(); });

  push('skillsManager.search', async () => {
    const state = store.read();
    const decorated = reconcile(state.skills, state.repositories, await deps.scanner.scan());
    const picker = vscode.window.createQuickPick<{ id: string; label: string; detail: string }>();
    picker.placeholder = '搜索 skill（名称 / skill id / repository）';
    const items = decorated.map(skill => ({
      id: decoratedKey(skill),
      label: skill.name,
      detail: `${skill.repository.name} · ${skill.status} · ${skill.source || 'No source'}`,
    }));
    picker.items = items;
    picker.onDidChangeValue(value => {
      const query = value.toLowerCase();
      picker.items = items.filter(item =>
        item.label.toLowerCase().includes(query)
        || item.id.toLowerCase().includes(query)
        || item.detail.toLowerCase().includes(query));
    });
    picker.onDidAccept(() => {
      const selected = picker.selectedItems[0];
      picker.dispose();
      if (selected) { provider.setSelection(selected.id); }
    });
    picker.show();
  });

  push('skillsManager.filterStatus', async () => {
    const picked = await vscode.window.showQuickPick(
      [
        { label: 'All', value: 'all' as StatusFilter },
        { label: 'Installed', value: 'installed' as StatusFilter },
        { label: 'Not Wanted', value: 'unwanted' as StatusFilter },
        { label: 'Diff', value: 'diff' as StatusFilter },
      ],
      { placeHolder: '过滤状态' },
    );
    if (!picked) { return; }
    store.update('statusFilter', picked.value);
    provider.refresh();
  });

  const setGroup = (group: GroupDimension) => {
    store.update('groupBy', group);
    vscode.commands.executeCommand('setContext', 'skillsManager.groupBy', group);
    provider.refresh();
  };
  push('skillsManager.groupByCategory', () => setGroup('category'));
  push('skillsManager.groupByCategoryCurrent', () => setGroup('category'));
  push('skillsManager.groupBySource', () => setGroup('source'));
  push('skillsManager.groupBySourceCurrent', () => setGroup('source'));
  push('skillsManager.groupByStatus', () => setGroup('status'));
  push('skillsManager.groupByStatusCurrent', () => setGroup('status'));
  push('skillsManager.groupByScope', () => setGroup('scope'));
  push('skillsManager.groupByScopeCurrent', () => setGroup('scope'));
  push('skillsManager.groupByFlat', () => setGroup('flat'));
  push('skillsManager.groupByFlatCurrent', () => setGroup('flat'));

  push('skillsManager.installSelected', async (
    node?: SkillNode,
    selection?: readonly SkillNode[],
  ) => {
    const nodes = selectedSkillNodes(node, selection)
      .filter(item => item.skill!.installedAgents.length === 0 && !item.skill!.extra);
    if (nodes.length === 0) { return; }
    const sourceLess = nodes.filter(item => !hasSource(item.skill!));
    if (sourceLess.length > 0 && !(await confirmMissingSourceCleanup(sourceLess))) { return; }

    const cleanupKeys = new Set(sourceLess.map(skillKey));
    const state = store.read();
    state.skills = state.skills.filter(skill => !cleanupKeys.has(declarationKey(skill)));
    const installable: ResolvedSkill[] = [];
    for (const selected of nodes) {
      if (cleanupKeys.has(skillKey(selected))) { continue; }
      const current = selected.skill!;
      const declaration = findDeclaration(state.skills, current);
      if (!declaration) { continue; }
      setWantedOverride(declaration, repositoryFor(state, declaration), true);
      installable.push({ ...current, wanted: true });
    }
    store.write(state);
    await installSkills(installable);
    await rescan();
  });

  push('skillsManager.uninstallSelected', async (
    node?: SkillNode,
    selection?: readonly SkillNode[],
  ) => {
    const nodes = selectedSkillNodes(node, selection)
      .filter(item => item.skill!.installedAgents.length > 0);
    if (nodes.length === 0) { return; }
    const sourceLess = nodes.filter(item => !hasSource(item.skill!));
    if (sourceLess.length > 0 && !(await confirmSourceLessCleanup(sourceLess))) { return; }

    const cleanupKeys = new Set(sourceLess.map(skillKey));
    const state = store.read();
    for (const selected of nodes) {
      if (cleanupKeys.has(skillKey(selected))) { continue; }
      const current = selected.skill!;
      const declaration = findDeclaration(state.skills, current);
      if (declaration) {
        setWantedOverride(declaration, repositoryFor(state, declaration), false);
      }
    }
    state.skills = state.skills.filter(skill => !cleanupKeys.has(declarationKey(skill)));
    store.write(state);
    await uninstallSkills(nodes.map(item => item.skill!));
    await rescan();
  });

  const forward = (target: string) => (
    node?: SkillNode,
    selection?: readonly SkillNode[],
  ) => vscode.commands.executeCommand(target, node, selection);
  push('skillsManager.inlineWanted', forward('skillsManager.toggleWanted'));
  push('skillsManager.inlineUnwanted', forward('skillsManager.toggleWanted'));
  push('skillsManager.inlineInstalled', forward('skillsManager.uninstallSelected'));
  push('skillsManager.inlineMissing', forward('skillsManager.installSelected'));

  push('skillsManager.syncToData', async () => {
    const scan = await deps.scanner.scan();
    const state = store.read();
    const current = reconcile(state.skills, state.repositories, scan);
    const existing = new Map(current.map(skill => [`${skill.scope}:${skill.id}`, skill]));
    const repositories = new Map(state.repositories.map(repo => [repo.repoId, repo]));
    const declarations: DeclaredSkill[] = [];
    for (const scope of ['global', 'project'] as SkillScope[]) {
      const installed = scope === 'global' ? scan.globalSkills : scan.projectSkills;
      for (const item of installed) {
        const source = item.source ?? '';
        const repoId = repositoryId(source, `${scope}:${item.folderName}`);
        let repository = repositories.get(repoId);
        if (!repository) {
          repository = {
            repoId,
            name: repositoryName(repoId, item.folderName),
            source,
            category: 'Default',
            wanted: true,
            dateAdded: new Date().toISOString(),
          };
          repositories.set(repoId, repository);
        }
        const available = new Map(
          (repository.availableSkills ?? []).map(skill => [skill.skillId, skill]),
        );
        available.set(item.folderName, { skillId: item.folderName, name: item.name });
        repository.availableSkills = Array.from(available.values());

        const previous = existing.get(`${scope}:${item.folderName}`);
        const declaration: DeclaredSkill = {
          id: item.folderName,
          skillId: item.folderName,
          repoId,
          name: item.name,
          dateAdded: previous?.dateAdded || new Date().toISOString(),
          scope,
          note: previous?.note,
        };
        if (previous && previous.category !== (repository.category ?? 'Default')) {
          declaration.category = previous.category;
        }
        declarations.push(declaration);
      }
    }
    store.write({ ...state, repositories: Array.from(repositories.values()), skills: declarations });
    await rescan();
    vscode.window.showInformationMessage(`Synced ${declarations.length} installed skill(s) into list.`);
  });

  push('skillsManager.syncFromData', async () => {
    const scan = await deps.scanner.scan();
    const state = store.read();
    const decorated = reconcile(state.skills, state.repositories, scan);
    const toInstall = decorated.filter(skill => skill.status === 'wanted-missing' && !skill.extra);
    const toUninstall = decorated.filter(skill => skill.status === 'unwanted-installed');
    if (toInstall.length === 0 && toUninstall.length === 0) {
      vscode.window.showInformationMessage('已同步，无差异。');
      return;
    }
    const action = await vscode.window.showWarningMessage(
      `将安装 ${toInstall.length} 个、卸载 ${toUninstall.length} 个 skill。继续？`,
      '继续',
    );
    if (action !== '继续') { return; }
    await uninstallSkills(toUninstall);
    await installSkills(toInstall);
    await rescan();
  });

  push('skillsManager.openSkillMd', async (node?: SkillNode) => {
    const installedPath = node?.skill?.installedPath;
    if (installedPath) {
      await vscode.commands.executeCommand(
        'vscode.open',
        vscode.Uri.file(path.join(installedPath, 'SKILL.md')),
      );
    }
  });
  push('skillsManager.previewSkillMd', async (node?: SkillNode) => {
    const installedPath = node?.skill?.installedPath;
    if (installedPath) {
      await vscode.commands.executeCommand(
        'markdown.showPreview',
        vscode.Uri.file(path.join(installedPath, 'SKILL.md')),
      );
    }
  });
  push('skillsManager.copyPath', async (
    node?: SkillNode,
    selection?: readonly SkillNode[],
  ) => {
    const paths = Array.from(new Set(
      selectedSkillNodes(node, selection)
        .map(item => item.skill?.installedPath)
        .filter((value): value is string => Boolean(value)),
    ));
    if (paths.length === 0) { return; }
    await vscode.env.clipboard.writeText(paths.join('\n'));
    vscode.window.showInformationMessage(
      paths.length === 1 ? '路径已复制' : `已复制 ${paths.length} 个路径`,
    );
  });
  push('skillsManager.openDataFile', async () => {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(store.dataFilePath()));
  });
  push('skillsManager.removeAllData', async () => {
    const action = await vscode.window.showWarningMessage(
      '删除全部声明数据（data.json）？已安装的 skill 不会被卸载。',
      '删除',
    );
    if (action !== '删除') { return; }
    store.write({ ...store.DEFAULTS, repositories: [], skills: [], categories: ['Default'] });
    await rescan();
  });

  return subs;
}

function selectedSkillNodes(
  node?: SkillNode,
  selection?: readonly SkillNode[],
): SkillNode[] {
  const candidates = selection?.length ? selection : node ? [node] : [];
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    if (!candidate.skill) { return false; }
    const key = skillKey(candidate);
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
}

function skillKey(node: SkillNode): string {
  return decoratedKey(node.skill!);
}

function decoratedKey(skill: Pick<DecoratedSkill, 'scope' | 'repoId' | 'skillId'>): string {
  return `${skill.scope}:${skill.repoId}:${skill.skillId}`;
}

function declarationKey(skill: Pick<DeclaredSkill, 'scope' | 'repoId' | 'skillId'>): string {
  return `${skill.scope}:${skill.repoId}:${skill.skillId}`;
}

function findDeclaration(
  declarations: DeclaredSkill[],
  skill: Pick<DecoratedSkill, 'scope' | 'repoId' | 'skillId'>,
): DeclaredSkill | undefined {
  const key = decoratedKey(skill);
  return declarations.find(item => declarationKey(item) === key);
}

function repositoryFor(state: SkillsState, skill: DeclaredSkill): SkillRepository {
  return state.repositories.find(repo => repo.repoId === skill.repoId) ?? {
    repoId: skill.repoId,
    name: repositoryName(skill.repoId, skill.name),
    source: skill.source ?? '',
    category: 'Default',
    wanted: true,
    dateAdded: skill.dateAdded,
  };
}

function upsertRepository(state: SkillsState, input: SkillRepository): SkillRepository {
  const existing = state.repositories.find(repo => repo.repoId === input.repoId);
  if (!existing) {
    state.repositories.push(input);
    return input;
  }
  existing.name = input.name || existing.name;
  existing.source = input.source || existing.source;
  existing.availableSkills = input.availableSkills ?? existing.availableSkills;
  return existing;
}

function setWantedOverride(
  skill: DeclaredSkill,
  repository: SkillRepository,
  wanted: boolean,
): void {
  skill.wanted = wanted === (repository.wanted ?? true) ? undefined : wanted;
}

function hasSource(skill: Pick<ResolvedSkill, 'source'>): boolean {
  return skill.source.trim().length > 0;
}

async function confirmSourceLessCleanup(nodes: SkillNode[]): Promise<boolean> {
  const installed = nodes.some(node => node.skill!.installedAgents.length > 0);
  const action = installed ? '卸载并清理' : '从列表清理';
  const consequence = installed ? '卸载后将无法自动重新安装' : '当前无法自动重新安装';
  const question = installed ? '是否卸载并从列表清理？' : '是否直接从列表清理？';
  const choice = await vscode.window.showWarningMessage(
    `${skillNames(nodes)} 没有原始 Source，${consequence}。${question}`,
    { modal: true },
    action,
  );
  return choice === action;
}

async function confirmMissingSourceCleanup(nodes: SkillNode[]): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `${skillNames(nodes)} 没有原始 Source，无法安装。是否从列表清理？`,
    { modal: true },
    '从列表清理',
  );
  return choice === '从列表清理';
}

function skillNames(nodes: SkillNode[]): string {
  const names = nodes.map(node => `"${node.skill!.name}"`);
  return names.length <= 3
    ? names.join('、')
    : `${names.slice(0, 3).join('、')} 等 ${names.length} 个 skill`;
}

async function collectSourceInput(type: SourceTypeLabel): Promise<SourceInput | undefined> {
  switch (type) {
    case 'GitHub': {
      const value = await vscode.window.showInputBox({
        prompt: 'GitHub 仓库 URL 或 owner/repo',
        placeHolder: 'https://github.com/everyinc/compound-engineering-plugin',
        validateInput: input => (input.trim() ? '' : '必填'),
      });
      if (!value) { return undefined; }
      return { source: normalizeSource(value), defaultId: repoBasename(value) };
    }
    case 'skills.sh': {
      const value = await vscode.window.showInputBox({
        prompt: '粘贴复制的 npx skills add 命令',
        placeHolder: 'npx skills add owner/repo --skill skill-id',
        validateInput: input => (input.trim() ? '' : '必填'),
      });
      if (!value) { return undefined; }
      const parsed = parseNpxCommand(value);
      if (!parsed.source) { return undefined; }
      return {
        source: parsed.source,
        defaultId: parsed.skill ?? repoBasename(parsed.source),
        requestedSkill: parsed.skill,
      };
    }
    case 'skillhub.cn': {
      const value = await vscode.window.showInputBox({
        prompt: '粘贴 skillhub.cn skill 链接',
        placeHolder: 'https://skillhub.cn/skills/find-skill-skillhub',
        validateInput: input => (input.trim() ? '' : '必填'),
      });
      if (!value) { return undefined; }
      return {
        source: normalizeSource(value),
        defaultId: value.replace(/\/$/, '').split('/').pop() ?? 'skill',
      };
    }
    case 'Local': {
      const value = await vscode.window.showInputBox({
        prompt: '本地 skill 目录路径（绝对路径更稳）',
        placeHolder: '/Users/pj/code/my-skills/drawio',
        validateInput: input => (input.trim() ? '' : '必填'),
      });
      if (!value) { return undefined; }
      const source = normalizeSource(value);
      const defaultId = classifySource(source) === 'local'
        ? path.basename(localPath(source))
        : 'skill';
      return { source, defaultId };
    }
  }
}

async function pickScope(): Promise<SkillScope | undefined> {
  const preference = vscode.workspace.getConfiguration('skills-manager')
    .get<string>('defaultScope', 'global');
  if (preference === 'global' || preference === 'project') { return preference; }
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Global', value: 'global' as SkillScope },
      { label: 'Project', value: 'project' as SkillScope },
    ],
    { placeHolder: '安装范围' },
  );
  return picked?.value;
}

async function resolveInstallId(
  defaultId: string,
  scope: SkillScope,
  skills: DeclaredSkill[],
): Promise<string | undefined> {
  const id = defaultId.trim();
  const exists = (candidate: string) =>
    skills.some(skill => skill.id === candidate && skill.scope === scope);
  if (!exists(id)) { return id; }
  const suggested = nextAvailableId(id, exists);
  const picked = await vscode.window.showInputBox({
    title: 'Duplicate Install ID',
    prompt: `"${id}" already exists in ${scope} scope. Choose another install directory name.`,
    value: suggested,
    valueSelection: [0, suggested.length],
    validateInput: value => {
      const candidate = value.trim();
      if (!candidate) { return 'ID is required.'; }
      return exists(candidate) ? `"${candidate}" already exists in ${scope} scope.` : '';
    },
  });
  return picked?.trim() || undefined;
}

function nextAvailableId(base: string, exists: (candidate: string) => boolean): string {
  let suffix = 2;
  while (exists(`${base}-${suffix}`)) { suffix++; }
  return `${base}-${suffix}`;
}

function repoBasename(value: string): string {
  return value.replace(/\.git$/, '').replace(/^.*\//, '').replace(/\/tree\/.*/, '').toLowerCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
