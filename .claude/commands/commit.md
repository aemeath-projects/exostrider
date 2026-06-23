# /exostrider:commit — 创建 Commit

分析当前 git 改动，生成符合项目 Conventional Commits 规范的提交信息，支持拆分提交建议。

## 参数

| 参数           | 类型  | 默认值 | 说明                                     |
|--------------|-----|-----|----------------------------------------|
| `$ARGUMENTS` | 正整数 | 无限制 | 允许的最大提交次数。设为 `1` 时强制将所有变更合并为一次提交，不得拆分。 |

**使用示例：**

- `/exostrider:commit` — 按拆分原则自动判断提交次数
- `/exostrider:commit 1` — 强制所有变更在一次提交中完成

## 执行步骤

### 0. 解析参数

读取 `$ARGUMENTS`（可能为空）：

- 若为空：`max_commits = ∞`，正常执行拆分逻辑
- 若为正整数 `N`：`max_commits = N`，提交数量**不得超过 N**
- 若为无效值：报错提示"参数必须为正整数"，终止执行

### 1. 分析当前改动

```bash
git status
git diff --stat
git diff
```

### 2. 变更分组

按以下维度对改动分组，判断是否需要拆分提交：

| 组别     | type       | 典型改动                         |
|--------|------------|------------------------------|
| 新功能    | `feat`     | 新增装饰器、新增路由类型、新增模块能力          |
| Bug 修复 | `fix`      | 修复拦截器逻辑、状态机转换、映射优先级错误        |
| 重构     | `refactor` | 不改变行为的结构调整、提取公共工具函数          |
| 样式/格式  | `style`    | eslint/prettier 自动格式化、空白行    |
| 文档     | `docs`     | CLAUDE.md、README.md、JSDoc 注释 |
| 测试     | `test`     | 新增/修改测试用例                    |
| 配置/杂项  | `chore`    | 依赖更新、CI、.claude/ 配置、构建脚本     |

**拆分原则（如违反则建议拆分）：**

- 功能代码 + 格式化 → 分开提交
- 多个不相关模块的功能变更 → 分开提交
- `src/` 改动 + `tests/` 改动 → 可同一提交（测试与实现强相关时）

**`max_commits` 约束（优先级高于拆分原则）：**

- 若分组结果超过 `max_commits`，必须将多个分组合并，直到提交数 ≤ `max_commits`
- 合并时优先将同 scope 或相关性最高的分组合并
- 当 `max_commits = 1` 时，无论变更多复杂，都必须生成单一提交，type 选用覆盖面最广的类型（优先级：`feat` > `fix` > `refactor` > `style` > `docs` > `chore`），description 简洁概括所有变更主旨

### 3. 生成 Commit Message

格式：

```
<type>(<scope>): <description>

[可选 body]
[可选 footer]
```

**语言要求（强制）：**

- `<description>`（简介）：**必须使用中文**
- `[body]`（完整提交内容）：**必须使用中文**
- footer 可使用英文（如 `BREAKING CHANGE:`、`Closes #123`）

**scope 推断规则：**

| 改动路径                                    | scope         |
|-----------------------------------------|---------------|
| `src/dispatch/`                         | `dispatch`    |
| `src/lifecycle/`                        | `lifecycle`   |
| `src/session/`                          | `session`     |
| `src/echo/`                             | `echo`        |
| `src/logger/`                           | `logger`      |
| `src/pool/`                             | `pool`        |
| `src/types/`                            | `types`       |
| `src/index.ts`（门面类 `Exostrider`）        | `core`        |
| `tests/unit/dispatch/`                  | `dispatch`    |
| `tests/unit/lifecycle/`                 | `lifecycle`   |
| `tests/unit/session/`                   | `session`     |
| `tests/integration/`                    | `integration` |
| `tests/robustness/`                     | `robustness`  |
| `.github/`, `*.config.*`, `pnpm-*.yaml` | `chore`       |
| `.claude/`                              | `chore`       |
| `README.md`, `SECURITY.md`              | `docs`        |

- 多模块同时改动：选主要改动的 scope，或 body 中列出涉及模块

**description 要求：**

- 祈使语气
- 不超过 72 字符
- 不加句号

### 4. 展示并确认

输出格式：

```
## 建议提交方案

### 提交 1（如需拆分则显示多个）
暂存文件：
  src/dispatch/mapping.ts
  tests/unit/dispatch/mapping.test.ts

提交信息：
  feat(dispatch): 新增 OnFullMatch 路由映射支持

---
是否按此方案提交？[确认 / 修改提交信息 / 拆分方案]
```

### 5. 执行提交

用户确认后执行：

```bash
git add <指定文件>
git commit -m "$(cat <<'EOF'
<type>(<scope>): <description>
EOF
)"
```

**强制要求：**

- 禁止 `--no-verify`（必须运行 pre-commit hooks）
- 禁止 `git add -A` 暗中包含 `.env` 等敏感文件（按文件显式 add）
- 若 hooks 失败，报告错误原因，不自动重试

## 特殊情况处理

- **工作区干净（无改动）：** 提示无需提交
- **改动仅含格式化：** 建议使用 `style` type，scope 为受影响的模块名
- **BREAKING CHANGE：** 在 footer 中加入 `BREAKING CHANGE: <说明>`，并在 description 或 body 中说明迁移方式