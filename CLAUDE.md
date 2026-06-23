# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# 构建
pnpm build           # tsup 生产构建
pnpm dev             # tsup 监听模式

# 代码质量
pnpm lint            # ESLint 检查
pnpm lint:fix        # ESLint 自动修复
pnpm format          # Prettier 检查
pnpm format:fix      # Prettier 自动修复
pnpm type-check      # tsc --noEmit

# 测试
pnpm test            # 运行全部测试（vitest run）
pnpm test:watch      # 监听模式
pnpm test:coverage   # 生成覆盖率报告

# 运行单个测试文件
pnpm test -- tests/unit/dispatch/registry.test.ts

# 版本发布
pnpm bump:patch   # 补丁版本 (1.0.x)
pnpm bump:minor   # 次要版本 (1.x.0)
pnpm bump:major   # 主版本 (x.0.0)
```

覆盖率阈值：functions 95%、lines 90%、branches 85%。

## 架构

本项目是一个**平台无关的事件驱动框架库**，泛型 `TEvent`/`TApis` 由宿主（调用方）传入。入口是 `Exostrider` 门面类，组装六个独立模块：

```
bootstrap 流程：
  Echo.discoverAll()           ← 扫描目录，import 触发装饰器副作用注册
  LifecycleOrchestrator.startup() ← Kahn 拓扑排序 + @Startup/@Inject/@Provide
  handlerRegistry.instantiate()   ← Handler 实例化 + 依赖注入
  handlerRegistry.buildMappings() ← 构建 CompositeHandlerMapping
  new EventDispatcher(mapping)    ← 分发器就绪
  pool.connectAll() + startHealthCheck() ← 可选，pool 配置后自动执行
```

### 六个模块

**Echo** (`src/echo/`)
- `EchoLoader`：按 `EchoConfig` 配置，扫描指定目录下的 `.ts/.js/.mts/.mjs` 文件并动态 import。import 是副作用——触发 `@Handler`/`@Service` 装饰器将元数据写入全局注册表。

**Lifecycle** (`src/lifecycle/`)
- `LifecycleOrchestrator`：读取 `ServiceEntry` 列表，Kahn BFS 拓扑排序，按序 `new` + `@Inject` + `@Startup`，完成后冻结 `ServiceRegistry`，关闭时逆序执行 `@Shutdown`。
- `ServiceRegistry<TMap>`：类型安全的服务容器，`startup` 完成后 `freeze()` 禁止新增。
- **全局单例**：`serviceEntryRegistry`（`@Service` 装饰器写入）。

**Dispatch** (`src/dispatch/`)
- **全局单例**：`handlerRegistry`（`@Handler` 装饰器写入）。测试中每 `beforeEach` 需调用 `handlerRegistry.clear()`。
- `CompositeHandlerMapping`：聚合 7 种子映射，按优先级顺序尝试匹配（command 10 → regex 20 → keyword 30 → startswith 40 → endswith 50 → fullmatch 60 → event 70）。`getAllHandlers` 返回所有命中处理器（供多播场景）。
- `EventDispatcher`：拦截器链顺序为 —— 全局 preHandle → 声明式 preHandle → handler.method → 声明式 postHandle（逆序）→ 全局 postHandle（逆序）→ afterCompletion（始终，逆序）。`FinishError` 视为正常终止，不传 error 给 afterCompletion。
- 路由装饰器：`@OnCommand`、`@OnKeyword`、`@OnRegex`、`@OnStartsWith`、`@OnEndsWith`、`@OnFullMatch`、`@OnEvent`。

**Session** (`src/session/`)
- `SessionManager<TContext>`：每个 key 维护一个活跃会话（由 `LockProvider` 互斥），含超时自动取消。接收 `processMessage` 时先检测 cancelCommands，再转发给 `StateMachine`。
- `StateMachine<TContext>`：有限状态机，`StateDefinition` 包含 `onEnter`/`onExit`/`onInput`，`onInput` 返回 `{ finished, nextState, data }`。
- 会话构建支持两种方式：`buildStates()` 配置式（优先）或装饰器 DSL。

**Logger** (`src/logger/`)
- 封装 pino，全局 `setLogger()` 统一注入到各模块。`LogBroadcaster` 允许外部订阅日志事件。

**Pool** (`src/pool/`)
- `ClientPool<TClient, TRole, TEvent>`：管理多个 `ClientAdapter` 实例，支持按角色（`RoleDefinition`）注册、连接/断开、健康检测。
- `ClientAdapter`：由宿主实现的协议适配器接口，包含 `connect()`/`disconnect()`/`healthCheck()`。可选方法 `wireToPool?(pool: PoolEmitter, role: string): void` 在 `addClient()` 时由连接池自动调用，用于将客户端原生事件绑定到连接池；`PoolEmitter` 是为避免循环依赖而抽取的最小接口。
- **路由策略**：`StickyStrategy`（同一 key 总路由到同一客户端）、`PriorityStrategy`（按 `priority` 数值升序优先）、`PriorityStickyStrategy`（两者结合）。`RoutingTable` 聚合策略并执行选择。
- **去重流水线**（`DedupPipeline`）：基于滑动窗口（`windowMs` + `maxCacheSize`）过滤重复事件，Key 由 `DedupKeyExtractor` 提取；收到事件后 emit `AggregatedEvent`。
- **可选模块**：在 `ExostriderOptions.pool` 中提供配置后，门面类自动在 bootstrap/shutdown 时管理连接生命周期。

### 重要约定

- **ESM only**：`moduleResolution: bundler`，`src/` 内部导入路径**禁止**使用 `.js` 后缀（直接写 `'./foo'` 即可）。
- **TC39 Stage 3 装饰器**：使用 `ClassMethodDecoratorContext`/`ClassDecoratorContext`，不是旧版 TypeScript 装饰器。
- **全局单例隔离**：`Exostrider` 设计为进程单实例。隔离测试时，每次测试前必须调用 `handlerRegistry.clear()`。
- **包导出路径**：`@aemeath-projects/exostrider`（主入口）、`/echo`、`/lifecycle`、`/dispatch`、`/session`、`/logger`、`/pool`、`/types`，均独立导出以支持 tree-shaking。
