# Git 工作流规则（强制执行）

## 提交格式（Conventional Commits）

所有提交必须遵循以下格式：

```
<type>(<scope>): <description>

[可选 body]
[可选 footer]
```

**type 枚举：**

| type       | 用途              |
|------------|-----------------|
| `feat`     | 新功能             |
| `fix`      | Bug 修复          |
| `refactor` | 重构（不改变行为）       |
| `style`    | 格式化/代码风格（不改变逻辑） |
| `docs`     | 文档变更            |
| `test`     | 测试相关            |
| `chore`    | 构建、依赖、CI/CD 等杂项 |
| `perf`     | 性能优化            |
| `ci`       | CI/CD 配置变更      |

**scope 示例：** `dispatch`、`lifecycle`、`session`、`echo`、`logger`、`pool`、`types`、`core`、`integration`、`robustness`

**description：** 使用中文，祈使语气，不超过 72 字符，不加句号。

示例：

```
feat(dispatch): 新增 OnFullMatch 路由装饰器
fix(session): 修复 StateMachine 在并发输入时的状态竞争
refactor(lifecycle): 将 Kahn 拓扑排序提取为独立工具函数
test(robustness): 补充并发分发的压力测试用例
```

## 提交粒度

- **一个提交做一件事**：功能开发、Bug 修复、重构、格式化必须分开提交
- **禁止**在同一提交中混合：新功能 + 重构 + 样式修改
- 实现代码与配套测试可放同一提交（强相关时），但测试覆盖补全应单独提交

## 分支管理

- **功能分支**：从 `master` 切出，命名 `feat/<short-desc>` 或 `fix/<short-desc>`
- **禁止**直接 push 到 `master`（通过 settings.json 权限控制辅助约束）
- 分支生命周期短暂，合并后立即删除

## PR 流程

提交 PR 前必须通过以下检查（本地自验）：

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

- PR 描述必须说明：**变更原因**、**实现方式**、**验证步骤**
- 涉及公共 API 变更的 PR 必须在描述中说明向后兼容性或 BREAKING CHANGE

## 禁止操作

- **禁止** `git push --force` 到 `master`（保护共享历史）
- **禁止** `git commit --no-verify` 跳过 pre-commit hooks
- **禁止** `git reset --hard` 抹除已推送的提交（使用 `revert` 代替）
- **禁止**提交包含以下内容的文件：`.env`、`*.pem`、`*secret*`、包含硬编码密钥的配置文件
- **禁止** `dist/` 目录提交到版本库（已在 `.gitignore` 中排除）

## 变更范围控制

- 避免「顺手」改动：修复 Bug 时发现的代码风格问题，应在独立 commit 或 PR 中处理
- 大型重构分多个小 PR 逐步合并，每个 PR 保持独立可回滚