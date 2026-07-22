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

扫描 `src/` 和 `tests/` 目录，按以下维度逐一检查（$ARGUMENTS 指定模块时，只关注该模块相关的检查项）：

**🔒 安全**

- 硬编码的 secrets、token、密码、API key
- `eval()`、`Function()` 构造器、`vm.runInNewContext()` 处理外部数据
- 动态 `import()` 使用用户可控路径（`EchoLoader` 仅允许扫描配置目录下的白名单文件）
- `ClientAdapter` 的 `connect()`/`disconnect()`/`wireToPool()` 抛出异常未被 `ClientPool` 内部捕获，透传为未处理拒绝
- `ClientAdapter.client`（原始协议客户端）被直接暴露给 Handler 层，而非通过 Pool 事件（`AggregatedEvent`）传递

**🏗️ 结构/SRP**

- 跨模块深层导入内部实现文件，而非通过对应模块 `index.ts` 的导出 API（`echo`/`lifecycle`/`dispatch`/`session`/`logger`/`pool` 六模块边界）
- `src/types/` 中的接口导入了其他模块的内容
- 已存在跨模块复用的工具函数（如按 injects 元数据赋值服务实例的逻辑）时，多个模块各自重新实现一遍相近逻辑，而非抽取为公开工具函数并从对应 `index.ts` 导出
- `handlerRegistry` / `serviceEntryRegistry` 在 `startup` 完成后未调用 `freeze()` 禁止运行期修改
- 测试文件 `beforeEach` 缺少 `handlerRegistry.clear()` 调用（各 handler 测试必须清理）
- 测试文件未重置 `serviceEntryRegistry`（lifecycle 相关测试）
- 跨测试用例共享全局状态导致测试顺序依赖
- `@Handler` 类装饰器与方法路由装饰器（`@OnCommand` 等）未配对使用
- 装饰器副作用（写入全局注册表）非幂等，重复执行产生副作用或报错
- 路由装饰器元数据未通过 `src/dispatch/decorators/symbols.ts` 定义的 Symbol key 存储，在其他位置新建了等价的 Symbol

**⚠️ 错误处理与可观测性**

- 裸 `catch (e)` 后静默吞错（无 `logger.error` 或 pino 日志）
- `throw new Error('...')` 而非 `src/dispatch/errors.ts` 中定义的异常类
- `void somePromise()` 忽略 Promise 拒绝（无明确意图注释时）
- Handler 方法缺少路由装饰器（`@OnCommand`、`@OnKeyword` 等）但仍被实例化

**⚡ 性能**

- 拦截器链中同步阻塞操作（应使用 `async/await`）
- 并发独立 I/O 串行 `await`（应使用 `Promise.all()`）
- Handler 方法中未使用 `await` 的异步调用（忽略 Promise 拒绝）
- `SessionManager` 中无限增长的会话 Map（缺少 TTL 清理机制）

**📐 代码质量与规则**

- 命名规范违规：源文件名未用 `kebab-case`、接口带 `I` 前缀、Symbol 变量未用 `UPPER_CASE`、`const` 对象（`as const`）未用 `PascalCase` 等（全表见 `coding-style.md`"命名规范"）
- 循环依赖（模块间互相 `import`）
- `devDependencies` 泄漏到 `dependencies`（影响下游用户的 bundle size 和安全面）
- `src/` 内部模块导入使用了 `.js` 后缀（`moduleResolution: bundler` 下禁止使用扩展名，直接写 `'./foo'` 即可）
- 类型专用导入未使用 `import type`
- 公共 API（`index.ts` 导出的类、方法）缺少 JSDoc 文档
- 装饰器使用了未从 `@aemeath-projects/exostrider` 导出的内部 symbol
- 使用旧版 TypeScript 装饰器语法（`experimentalDecorators`）而非 TC39 Stage 3

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

### 🔒 安全（X 项）
🔴 ...
🟡 ...

### 🏗️ 结构/SRP（X 项）
| 文件 | 问题 | 建议修复 |
|------|------|---------|
🔴 ...

### ⚠️ 错误处理与可观测性（X 项）
...

### ⚡ 性能（X 项）
...

### 📐 代码质量与规则（X 项，含命名规范/循环依赖/导入规范等）
...

### ✅ 未发现问题的模块
- ...

---
总计：X Critical / X Warning / X Info（按维度细分见上）
建议优先修复 Critical 项，其余可在独立 commit 中处理。
```

## 执行后行动

报告生成后，询问用户是否需要：

1. **逐项修复** — 从 Critical 开始，每次修复一个问题
2. **生成修复清单** — 保存为待办事项，分批处理
3. **仅查阅** — 不立即修改代码
