# /exostrider:bump — 版本号更新与打 Tag

自动化版本发布流程：解析参数 → 前置检查 → 预览变更 → 执行 bump → 询问推送。

底层工具：`commit-and-tag-version`，读取 Conventional Commits 自动推断升级级别，
同步更新 `package.json`，并生成/追加 `CHANGELOG.md`。

## 用法

```
/exostrider:bump                  # 由工具根据 commits 自动推断级别（推荐）
/exostrider:bump patch            # 强制 patch 升级（1.2.1 → 1.2.2）
/exostrider:bump minor            # 强制 minor 升级（1.2.1 → 1.3.0）
/exostrider:bump major            # 强制 major 升级（1.2.1 → 2.0.0）
/exostrider:bump --dry-run        # 仅预览，不执行任何写入操作
/exostrider:bump minor --dry-run  # 强制 minor 级别的 dry-run 预览
```

参数 `$ARGUMENTS` 可包含以下内容（顺序不限）：

- 升级级别：`patch` / `minor` / `major`（可选，默认由工具从 commits 自动推断）
- `--dry-run`：只预览，不写文件，不提交，不打 tag

---

## 执行步骤

### 1. 解析参数

从 `$ARGUMENTS` 中提取：

- `BUMP_LEVEL`：`patch` / `minor` / `major` 之一，若未指定则留空（工具自动推断）
- `DRY_RUN`：若包含 `--dry-run` 则为 true

### 2. 前置检查

```bash
git status --porcelain
git branch --show-current
```

**检查项：**

| 检查                           | 失败时的处理                           |
| ------------------------------ | -------------------------------------- |
| 工作区必须干净（无未提交变更） | 列出脏文件，提示先提交或暂存，终止流程 |
| 当前必须在 `master` 分支       | 提示当前分支名，询问是否仍要继续       |

### 3. Dry-run 预览

无论是否传入 `--dry-run`，**始终先执行 dry-run**，让用户看到将要发生的变更：

```bash
# 有指定级别时
pnpm bump --dry-run --release-as <BUMP_LEVEL>

# 未指定级别时（自动推断）
pnpm bump --dry-run
```

**展示格式：**

```
## 版本发布预览

当前版本：0.1.0
新版本：  0.2.0
Tag：     v0.2.0
Commit：  chore(release): v0.2.0

将更新的文件：
  package.json     "version": "0.2.0"
  CHANGELOG.md     追加本次版本变更记录
```

若 `DRY_RUN=true`，在此处输出结果后**直接结束**，提示用户去掉 `--dry-run` 再执行。

### 4. 用户确认

展示预览后询问：

```
确认执行版本发布？[确认 / 取消]
```

若取消，终止流程，不做任何修改。

### 5. 执行 bump

用户确认后执行：

```bash
# 有指定级别时
pnpm bump:patch   # 或 bump:minor / bump:major

# 未指定级别时
pnpm bump
```

工具将自动完成：

- 读取 `package.json` 的当前版本
- 更新 `package.json` 中的版本号
- 追加本次版本变更到 `CHANGELOG.md`（按 feat / fix / perf / refactor 分类）
- 生成 commit：`chore(release): v<new_version>`
- 创建 tag：`v<new_version>`

### 6. 展示结果

```bash
git log --oneline -3
git tag --sort=-version:refname | head -5
```

输出格式：

```
## 发布完成

版本：0.1.0 → 0.2.0
Tag：v0.2.0
Commit：chore(release): v0.2.0

最新 Tag：
  v0.2.0
  v0.1.0
  ...

CHANGELOG.md 已更新，查看本次记录：
  cat CHANGELOG.md | head -40
```

### 7. 询问是否推送

```
是否推送到远端？（git push && git push --tags）[是 / 否]
```

若用户确认推送，执行：

```bash
git push && git push --tags
```

推送成功后输出远端地址和推送的 tag 名称。若用户选择否，提示可以稍后手动执行上述命令。

---

## 手动生成 CHANGELOG

仅更新 `CHANGELOG.md`，不修改版本号、不创建 commit 或 tag：

```bash
pnpm changelog
```

适用场景：

- 在 bump 前预览变更内容
- 修复上次 bump 后 CHANGELOG 内容有误的情况

---

## 特殊情况处理

- **工具推断后无可升级内容**（近期无符合规范的 commits）：显示工具输出，提示使用 `bump:patch/minor/major` 强制指定级别
- **bump 执行失败**：显示完整错误信息，不执行推送步骤
- **推送失败**：显示错误信息，提示检查远端连接或权限