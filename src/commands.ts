/**
 * Command registrations. Wired in extension.ts via registerCommands(deps).
 *
 * Key flows:
 *  - addSkill  : source-type wizard → collect input → write declaration → optional sync.
 *  - syncToData: scan result → write declared list (initialize from reality).
 *  - syncFromData: declared list → install/uninstall to match (wanted-missing install,
 *    unwanted-installed uninstall).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { DeclaredSkill, GroupDimension, SkillScope, StatusFilter } from './types';
import * as store from './store';
import { normalizeSource, parseNpxCommand, classifySource, localPath } from './source';
import { SkillScanner } from './scanner';
import { SkillsTreeProvider, SkillNode } from './provider';
import { installSkill, uninstallSkill } from './installer';
import { reconcile } from './reconcile';

export interface CommandDeps {
  scanner: SkillScanner;
  provider: SkillsTreeProvider;
  rescan: () => Promise<void>;
}

type SourceTypeLabel = 'GitHub' | 'skills.sh' | 'skillhub.cn' | 'Local';

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const { provider, rescan } = deps;
  const subs: vscode.Disposable[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const push = (cmd: string, fn: (...args: any[]) => unknown) =>
    subs.push(vscode.commands.registerCommand(cmd, fn));

  // ── Add Skill wizard ──────────────────────────────────────────────────────
  push('skillsManager.addSkill', async () => {
    const picked = await vscode.window.showQuickPick(
      [
        { label: '$(github) GitHub', type: 'GitHub' as SourceTypeLabel, detail: '从 GitHub 仓库安装 — 输入 URL 或 owner/repo' },
        { label: '$(package) skills.sh', type: 'skills.sh' as SourceTypeLabel, detail: '粘贴复制的 npx skills add 命令' },
        { label: '$(link) skillhub.cn', type: 'skillhub.cn' as SourceTypeLabel, detail: '粘贴 skillhub.cn 详情页链接' },
        { label: '$(folder) Local', type: 'Local' as SourceTypeLabel, detail: '指向本地 skill 目录（建 symlink，绝对路径更稳）' },
      ],
      { placeHolder: '选择 skill 源类型', title: 'Add Skill — 源类型' },
    );
    if (!picked) { return; }
    const result = await collectSourceInput(picked.type);
    if (!result) { return; }

    // Confirm id (default derived from source).
    const id = await vscode.window.showInputBox({
      prompt: 'skill id（落地目录名，小写中划线）',
      value: result.defaultId,
      validateInput: v => (v.trim() ? '' : 'id 不能为空'),
    });
    if (!id) { return; }

    const name = await vscode.window.showInputBox({
      prompt: '显示名（可留空，取 SKILL.md 或 id）',
      value: result.defaultId,
    });

    const scope = await pickScope();
    if (!scope) { return; }

    const declared: DeclaredSkill = {
      id: id.trim(),
      name: (name?.trim() || id.trim()),
      source: result.source,
      category: 'Default',
      wanted: true,
      dateAdded: new Date().toISOString(),
      scope,
    };

    const skills = store.get('skills');
    if (skills.some(s => s.id === declared.id && s.scope === declared.scope)) {
      const overwrite = await vscode.window.showWarningMessage(
        `Skill "${declared.id}" (${declared.scope}) 已存在，覆盖？`, '覆盖');
      if (overwrite !== '覆盖') { return; }
    }
    store.update('skills', [...skills.filter(s => !(s.id === declared.id && s.scope === declared.scope)), declared]);
    await rescan();

    const sync = await vscode.window.showInformationMessage(
      `已添加 "${declared.id}"。立即安装？`, '安装');
    if (sync === '安装') {
      await installSkill(declared);
      await rescan();
    }
  });

  // ── Remove / Edit / Toggle ────────────────────────────────────────────────
  push('skillsManager.removeSkill', async (node?: SkillNode) => {
    const s = node?.skill;
    if (!s || s.extra) { return; }
    const skills = store.get('skills').filter(x => !(x.id === s.id && x.scope === s.scope));
    store.update('skills', skills);
    await rescan();
  });

  push('skillsManager.editSkill', async (node?: SkillNode) => {
    const s = node?.skill;
    if (!s || s.extra) { return; }
    const skills = store.get('skills');
    const idx = skills.findIndex(x => x.id === s.id && x.scope === s.scope);
    if (idx < 0) { return; }
    const cur = skills[idx];

    const category = await vscode.window.showInputBox({ prompt: 'category', value: cur.category });
    if (category === undefined) { return; }
    const note = await vscode.window.showInputBox({ prompt: 'note', value: cur.note ?? '' });
    if (note === undefined) { return; }

    cur.category = category.trim() || 'Default';
    cur.note = note.trim() || undefined;
    skills[idx] = cur;
    store.update('skills', skills);
    await rescan();
  });

  push('skillsManager.toggleWanted', async (node?: SkillNode) => {
    const s = node?.skill;
    if (!s || s.extra) { return; }
    const skills = store.get('skills');
    const idx = skills.findIndex(x => x.id === s.id && x.scope === s.scope);
    if (idx < 0) { return; }
    skills[idx].wanted = !skills[idx].wanted;
    store.update('skills', skills);
    await rescan();
  });

  // ── Refresh / Search / Filter ─────────────────────────────────────────────
  push('skillsManager.refresh', async () => { await rescan(); });

  push('skillsManager.search', async () => {
    const state = store.read();
    const decorated = reconcile(state.skills, await deps.scanner.scan());
    const qp = vscode.window.createQuickPick<{ id: string; label: string; detail: string }>();
    qp.placeholder = '搜索 skill（名称 / id）';
    const items = decorated.map(s => ({
      id: `${s.scope}:${s.id}`,
      label: s.name,
      detail: [s.status, s.source].filter(Boolean).join(' · '),
    }));
    qp.items = items;
    qp.onDidChangeValue(v => {
      const low = v.toLowerCase();
      qp.items = items.filter(i => i.label.toLowerCase().includes(low) || i.id.toLowerCase().includes(low));
    });
    qp.onDidAccept(() => {
      const sel = qp.selectedItems[0];
      qp.dispose();
      if (sel) { provider.setSelection(sel.id); }
    });
    qp.show();
  });

  push('skillsManager.filterStatus', async () => {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'All', value: 'all' as StatusFilter },
        { label: 'Installed', value: 'installed' as StatusFilter },
        { label: 'Not Wanted', value: 'unwanted' as StatusFilter },
        { label: 'Diff', value: 'diff' as StatusFilter },
      ],
      { placeHolder: '过滤状态' },
    );
    if (!pick) { return; }
    store.update('statusFilter', pick.value);
    provider.refresh();
  });

  // ── Group by (cycle via per-dimension commands) ───────────────────────────
  const setGroup = (g: GroupDimension) => {
    store.update('groupBy', g);
    vscode.commands.executeCommand('setContext', 'skillsManager.groupBy', g);
    provider.refresh();
  };
  push('skillsManager.groupByCategory', () => setGroup('category'));
  push('skillsManager.groupBySource', () => setGroup('source'));
  push('skillsManager.groupByStatus', () => setGroup('status'));
  push('skillsManager.groupByScope', () => setGroup('scope'));
  push('skillsManager.groupByFlat', () => setGroup('flat'));

  // ── Sync ──────────────────────────────────────────────────────────────────
  push('skillsManager.syncSkill', async (node?: SkillNode) => {
    const s = node?.skill;
    if (!s) { return; }
    if (s.extra) {
      // Adopt an undeclared installed skill → declare it as wanted.
      const declared: DeclaredSkill = {
        id: s.id, name: s.name, source: s.source || '', category: 'Default',
        wanted: true, dateAdded: new Date().toISOString(), scope: s.scope,
      };
      store.update('skills', [...store.get('skills'), declared]);
      await rescan();
      return;
    }
    const declared = store.get('skills').find(x => x.id === s.id && x.scope === s.scope);
    if (!declared) { return; }
    if (declared.wanted && s.status === 'wanted-missing') { await installSkill(declared); }
    else if (!declared.wanted && s.status === 'unwanted-installed') { await uninstallSkill(declared); }
    await rescan();
  });

  push('skillsManager.syncToData', async () => {
    const scan = await deps.scanner.scan();
    const existing = new Map(store.get('skills').map(s => [`${s.scope}:${s.id}`, s]));
    const declared: DeclaredSkill[] = [];
    for (const scope of ['global', 'project'] as SkillScope[]) {
      const list = scope === 'global' ? scan.globalSkills : scan.projectSkills;
      for (const inst of list) {
        const key = `${scope}:${inst.folderName}`;
        const prev = existing.get(key);
        declared.push({
          id: inst.folderName,
          name: inst.name,
          source: prev?.source ?? inst.source ?? '',
          category: prev?.category ?? 'Default',
          wanted: true,
          dateAdded: prev?.dateAdded ?? new Date().toISOString(),
          scope,
          note: prev?.note,
        });
      }
    }
    store.update('skills', declared);
    await rescan();
    vscode.window.showInformationMessage(`Synced ${declared.length} installed skill(s) into list.`);
  });

  push('skillsManager.syncFromData', async () => {
    const scan = await deps.scanner.scan();
    const decorated = reconcile(store.get('skills'), scan);
    const toInstall = decorated.filter(s => s.status === 'wanted-missing' && !s.extra);
    const toUninstall = decorated.filter(s => s.status === 'unwanted-installed');

    if (toInstall.length === 0 && toUninstall.length === 0) {
      vscode.window.showInformationMessage('已同步，无差异。');
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `将安装 ${toInstall.length} 个、卸载 ${toUninstall.length} 个 skill。继续？`, '继续');
    if (confirm !== '继续') { return; }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Syncing skills...', cancellable: false },
      async () => {
        for (const s of toUninstall) {
          const d = store.get('skills').find(x => x.id === s.id && x.scope === s.scope);
          if (d) { await uninstallSkill(d); }
        }
        for (const s of toInstall) {
          const d = store.get('skills').find(x => x.id === s.id && x.scope === s.scope);
          if (d) { await installSkill(d); }
        }
      });
    await rescan();
  });

  // ── Info / open ───────────────────────────────────────────────────────────
  push('skillsManager.openSkillMd', async (node?: SkillNode) => {
    const p = node?.skill?.installedPath;
    if (p) { await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(`${p}/SKILL.md`)); }
  });
  push('skillsManager.previewSkillMd', async (node?: SkillNode) => {
    const p = node?.skill?.installedPath;
    if (p) { await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(`${p}/SKILL.md`)); }
  });
  push('skillsManager.copyPath', async (node?: SkillNode) => {
    const p = node?.skill?.installedPath;
    if (p) { await vscode.env.clipboard.writeText(p); vscode.window.showInformationMessage('路径已复制'); }
  });

  push('skillsManager.openDataFile', async () => {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(store.dataFilePath()));
  });

  push('skillsManager.removeAllData', async () => {
    const ok = await vscode.window.showWarningMessage(
      '删除全部声明数据（data.json）？已安装的 skill 不会被卸载。', '删除');
    if (ok !== '删除') { return; }
    store.write({ ...store.DEFAULTS, categories: ['Default'] });
    await rescan();
  });

  return subs;
}

// ── wizard helpers ─────────────────────────────────────────────────────────

async function collectSourceInput(
  type: SourceTypeLabel,
): Promise<{ source: string; defaultId: string } | undefined> {
  switch (type) {
    case 'GitHub': {
      const url = await vscode.window.showInputBox({
        prompt: 'GitHub 仓库 URL 或 owner/repo',
        placeHolder: 'https://github.com/vercel-labs/skills',
        validateInput: v => (v.trim() ? '' : '必填'),
      });
      if (!url) { return undefined; }
      const source = normalizeSource(url);
      return { source, defaultId: repoBasename(url) };
    }
    case 'skills.sh': {
      const cmd = await vscode.window.showInputBox({
        prompt: '粘贴复制的 npx skills add 命令',
        placeHolder: 'npx skills add https://github.com/vercel-labs/skills --skill find-skills',
        validateInput: v => (v.trim() ? '' : '必填'),
      });
      if (!cmd) { return undefined; }
      const { source, skill } = parseNpxCommand(cmd);
      if (!source) { return undefined; }
      return { source, defaultId: skill ?? repoBasename(source) };
    }
    case 'skillhub.cn': {
      const url = await vscode.window.showInputBox({
        prompt: '粘贴 skillhub.cn skill 链接',
        placeHolder: 'https://skillhub.cn/skills/find-skill-skillhub',
        validateInput: v => (v.trim() ? '' : '必填'),
      });
      if (!url) { return undefined; }
      const source = normalizeSource(url);
      return { source, defaultId: url.replace(/\/$/, '').split('/').pop() ?? 'skill' };
    }
    case 'Local': {
      const p = await vscode.window.showInputBox({
        prompt: '本地 skill 目录路径（绝对路径更稳）',
        placeHolder: '/Users/pj/code/my-skills/drawio 或 ~/code/my-skills/drawio',
        validateInput: v => (v.trim() ? '' : '必填'),
      });
      if (!p) { return undefined; }
      const source = normalizeSource(p);
      // Use the local dir basename as default id.
      const base = classifySource(source) === 'local'
        ? path.basename(localPath(source))
        : 'skill';
      return { source, defaultId: base };
    }
  }
}

async function pickScope(): Promise<SkillScope | undefined> {
  const pref = vscode.workspace.getConfiguration('skills-manager').get<string>('defaultScope', 'global');
  if (pref === 'global' || pref === 'project') { return pref; }
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Global', value: 'global' as SkillScope },
      { label: 'Project', value: 'project' as SkillScope },
    ],
    { placeHolder: '安装范围' },
  );
  return pick?.value;
}

function repoBasename(s: string): string {
  return s.replace(/\.git$/, '').replace(/^.*\//, '').replace(/\/tree\/.*/, '').toLowerCase();
}
