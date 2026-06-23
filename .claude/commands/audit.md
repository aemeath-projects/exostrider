# /exostrider:audit — 全量代码审计

对 codebase 进行全面分析，找出潜在 bug、性能问题和违反项目规则的代码。

**用法：**

- `/exostrider:audit` — 全量审计（默认）
- `/exostrider:audit dispatch` — 仅审计 dispatch 模块
- `/exostrider:audit lifecycle` — 仅审计 lifecycle 模块
- `/exostrider:audit session` — 仅审计 session 模块
- `/exostrider:audit pool` — 仅审计 pool 模块
- `/exostrider:audit tests` — 仅审计测试文件

当前范围：$ARGUMENTS（为空则默认 `all`）

## 审计维度

### 代码审计（`all` 或指定模块）

扫描 `src/` 和 `tests/` 目录，逐模块检查：

**安全问题（Critical）**

- 硬编码的 secrets、token、密码、API key
- `eval()`、`Function()` 构造器、`vm.runInNewContext()` 处理外部数据
- 动态 `import()` 使用用户可控路径（`EchoLoader` 仅允许扫描配置目录下的白名单文件）

**全局单例隔离（Critical）**

- 测试文件中 `beforeEach` 缺少 `handlerRegistry.clear()` 调用（各 handler 测试必须清理）
- 测试文件中未重置 `serviceEntryRegistry`（lifecycle 相关测试）
- 跨测试用例共享全局状态导致测试顺序依赖

**性能反模式（Warning）**

- 拦截器链中同步阻塞操作（应使用 `async/await`）
- 并发独立 I/O 串行 `await`（应使用 `Promise.all()`）
- Handler 方法中未使用 `await` 的异步调用（忽略 Promise 拒绝）
- `SessionManager` 中无限增长的会话 Map（缺少 TTL 清理机制）

**代码质量（Warning）**

- 裸 `catch (e)` 后静默吞错（无 `logger.error` 或 pino 日志）
- `void somePromise()` 忽略 Promise 拒绝（无明确意图注释时）
- Handler 方法缺少路由装饰器（`@OnCommand`、`@OnKeyword` 等）但仍被实例化
- 使用旧版 TypeScript 装饰器语法（`experimentalDecorators`）而非 TC39 Stage 3

**规则违反（Info）**

- `src/` 内部模块导入**使用了** `.js` 后缀（`moduleResolution: bundler` 下禁止使用扩展名，直接写 `'./foo'` 即可）
- 类型专用导入未使用 `import type`
- 公共 API（`index.ts` 导出的类、方法）缺少 JSDoc 文档
- 装饰器使用了未从 `@aemeath-projects/exostrider` 导出的内部 symbol

### 测试质量审计（`tests` 或 `all`）

扫描 `tests/` 目录：

**缺陷风险（Warning）**

- 集成测试（`tests/integration/`）未覆盖完整 bootstrap 流程（`Echo → Lifecycle → Dispatch → Pool`）
- 并发鲁棒性测试（`tests/robustness/`）未验证 `handlerRegistry.clear()` 的线程安全性
- `session-stress` 测试未验证超时自动取消行为

**覆盖率缺口（Info）**

- 检查 `pnpm test:coverage` 报告中低于阈值的模块（functions 95% / lines 90% / branches 85%）

## 输出格式

```
## 审计报告 — [范围] — [日期]

### 🔴 Critical（X 项）
| 文件 | 行号 | 问题 | 建议修复 |
|------|------|------|---------|
| ... | ... | ... | ... |

### 🟡 Warning（X 项）
...

### 🔵 Info（X 项）
...

### ✅ 未发现问题的模块
- src/echo/
- ...

---
总计：X Critical / X Warning / X Info
建议优先修复 Critical 项，其余可在独立 commit 中处理。
```

## 执行后行动

报告生成后，询问用户是否需要：

1. **逐项修复** — 从 Critical 开始，每次修复一个问题
2. **生成修复清单** — 保存为待办事项，分批处理
3. **仅查阅** — 不立即修改代码