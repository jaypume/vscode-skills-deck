# AGENTS.md

## 交流

- 使用专业、简洁的中文与用户沟通，直奔重点。
- 代码、日志、注释、命令名和发布说明一律使用英文。
- 先说明结果，避免冗长的实施总结。

## 产品定位

Skills Deck 是一个声明式 Agent Skills VS Code 管理器。持久化列表表示期望状态，
扫描器观察实际安装状态，reconcile 在运行时计算二者差异。

产品应保持 VS Code 原生体验：紧凑、上下文明确、便于快速浏览。优先使用
TreeView、QuickPick、ThemeIcon、右键菜单、进度和通知，不使用自定义 Webview
或终端驱动的界面。

## UX 偏好

- 保持树视图简洁，不要在每个 skill 标签后追加状态、Agent、来源等元数据。
  详细信息放在 Details 和 tooltip 中。
- 使用紧凑的行内操作和语义明确的图标；图标足够清楚时避免冗长按钮文案。
- Wanted/Unwanted 与 Installed/Missing 应独立展示、独立操作。
- Group By 统一放在一个下拉菜单中，标记当前选项；菜单标签包含简短示例值，
  分组节点使用主题感知图标与普通 skill 区分。
- 操作适合放入更多菜单时，不额外增加工具栏按钮。
- 仅在歧义会影响结果时询问，例如安装 ID 冲突、多 skill 仓库选择和破坏性清理确认。
- 安装、卸载和更新在后台执行，不打开 VS Code Terminal；展示进度以及完成或失败通知。
- GitHub 仓库及其子 skill 复用仓库 owner 头像。
- 忽略 `.system` 等隐藏 skill 目录，它们可能由运行时所有。

## 领域模型

持久化 schema 分为两层：

1. `SkillRepository` 标识来源仓库，保存共享元数据及已发现的 `availableSkills`。
2. `DeclaredSkill` 表示一个可独立管理的 skill 实例。

`skillId` 是最小身份和管理粒度，`repoId` 是稳定的仓库身份。`id` 是真实落盘目录名，
仅在受支持的冲突处理流程中允许与 `skillId` 不同。

skill 未提供覆盖值时继承仓库的 `source`、`category` 和 `wanted`；skill 级覆盖始终优先。
`sourceType` 由有效 source 推导，`scope` 属于 skill 实例。

不得持久化运行时安装状态。通过有效 `wanted` 与实际存在状态计算：

- `wanted-installed`
- `wanted-missing`
- `unwanted-installed`
- `unwanted-missing`
- `extra`：已安装但未声明

## 仓库与树视图行为

- 按每个 skill 的有效值进行分组、过滤和排序。
- 过滤后，再按 `scope + repoId` 将可见 skill 组合为展示层级。
- 仅在仓库包含多个 skill 时展示仓库父节点；单 skill 仓库直接展示 skill。
- 仓库子节点仍是独立 skill 记录，操作作用于其 `skillId`。
- Repository Update 重新发现可用 skill，仅让用户选择新增项，安装选中的新增项，
  并更新已安装的子 skill。
- Repository Delete 在目标 scope 中卸载并删除全部子 skill。
- 删除或设为 Unwanted 的无 source skill 时，必须提示其无法自动恢复，并提供明确的清理确认。

## 安装与发现

- 远程操作通过 `execFile` 调用 `npx skills`，不得使用 shell 命令字符串或集成终端。
- CLI 支持时，按 source 和 scope 批量执行远程安装。
- 本地 source 使用 symlink 管理。
- GitHub 添加流程使用 `skills add --list` 发现仓库 skill，并通过多选 QuickPick 选择。
- 尽可能从全局和 workspace 的 skills lock 文件恢复仓库 source 元数据。
- 保持 schema migration 和手工编辑的不完整 `data.json` 向后兼容。

## 架构边界

- `src/types.ts`：持久化与运行时领域类型。
- `src/store.ts`：规范化、迁移和文件持久化状态。
- `src/agentStore.ts`：机器级 Agent 偏好和 custom Agent 持久化。
- `src/config.ts`：当前设置及旧 namespace fallback。
- `src/known-agents.ts`：内置 Agent registry、路径解析和运行时 Agent 合并。
- `src/scanner.ts`：global/project 扫描与 lock source 恢复。
- `src/reconcile.ts`：继承和期望状态/安装状态差异计算。
- `src/provider.ts`：仓库/skill 分组 TreeView。
- `src/agentsView.ts`：Agent 分组及 Agent-owned/override/diff TreeView。
- `src/detailsView.ts`：原生 Details TreeView。
- `src/commands.ts`：用户工作流与状态变更。
- `src/agentCommands.ts`：Agent 启用、禁用、同步和 custom Agent 工作流。
- `src/installer.ts`：后台安装、卸载和更新。
- `src/agentSync.ts`：中央库与 enabled Agent 之间的安全 symlink 同步。
- `src/repositoryDiscovery.ts`：远程仓库 skill 发现。
- `src/source.ts`：source 解析、规范化和仓库身份。

保持职责边界，不要把运行时状态写入 store，也不要把渲染逻辑混入 installer。

## 规格与重大功能

- 重大功能设计、领域模型调整、持久化 schema 变更或跨模块行为调整，必须先沉淀 spec，
  在需求、边界、迁移、失败处理和验收标准明确后再实施。
- spec 放在仓库根目录 `.agents/plans/`，文件名为
  `YYYY-MM-DD-<topic>.spec.md`；后续实现应以该 spec 为准并同步维护。
- 普通小修复不要求新增 spec，避免为简单改动增加文档负担。

## 开发与发布

- 优先做聚焦的 TypeScript 修改并复用已有 helper，不顺手重构无关代码。
- 搜索使用 `rg`，编辑使用 `apply_patch`。
- 除非用户要求，否则不新增测试；但每次改动必须运行：

```sh
npm run typecheck
npm run build
git diff --check
```

- 发布前更新 `package.json`、`package-lock.json` 和 `CHANGELOG.md`，然后运行
  `npm run package`。
- 除非产品标识发生变化，Marketplace 图标继续使用 `media/icon.png`；
  必须保持足够分辨率的正方形 PNG。
- commit subject 使用 Conventional Commits。
- 未经用户明确要求，不 push、tag 或 publish。
