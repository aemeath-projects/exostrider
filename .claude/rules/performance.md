# 性能规则（强制执行）

## 拦截器链与分发效率

- 拦截器（`Interceptor`）的 `preHandle`/`postHandle`/`afterCompletion` 必须是 `async` 方法，**禁止**在其中执行同步阻塞操作（如大量 CPU 计算、`fs.readFileSync` 等）
- 并发独立 I/O 操作使用 `Promise.all()`，不要串行 `await`：
  ```typescript
  // ✅ 正确
  const [a, b] = await Promise.all([fetchA(), fetchB()])
  // ❌ 禁止
  const a = await fetchA()
  const b = await fetchB()
  ```
- `CompositeHandlerMapping` 的 7 种子映射按优先级顺序（10→70）尝试，命中后即停；**禁止**在映射匹配逻辑中执行网络请求或文件 I/O

## 会话管理

- `SessionManager` 的内部 Map 必须通过 TTL 超时机制自动清理过期会话，**禁止**无限增长
- 会话超时由 `LockProvider` 和超时取消机制共同保证；**禁止**用 `setTimeout` 规避并发问题
- 并发同一 key 的 `processMessage` 由 `LockProvider` 串行化，**禁止**在锁内执行耗时操作（会阻塞同 key 的后续消息）

## 全局注册表

- `handlerRegistry.buildMappings()` 和 `LifecycleOrchestrator.startup()` 仅在 bootstrap 阶段执行一次，**禁止**在每次分发时重建映射
- `ServiceRegistry.freeze()` 调用后锁定注册表；运行期不得再次调用 `register()`
- Echo 的目录扫描（`EchoLoader.discoverAll()`）是一次性操作，**禁止**在热路径（事件处理循环）中重复触发

## 内存管理

- Handler 实例在 `handlerRegistry.instantiate()` 时统一创建，之后复用；**禁止**每次事件分发时 `new` Handler
- 拦截器实例同上，一次注册全局复用
- **禁止** `void somePromise()` 忽略 Promise 拒绝，悬空的 rejected Promise 在 Node.js 中会触发 `unhandledRejection`，导致进程退出

## 连接池（Pool）

- `healthCheck.intervalMs` 不应设置过小（建议 ≥ 30000ms），避免高频健康检测阻塞正常消息处理
- `DedupPipeline` 的 `maxCacheSize` 必须设置合理上限，防止滑动窗口缓存无限增长；窗口关闭后缓存自动清理
- `ClientPool` 的 `connectAll()` 并发连接所有客户端，**禁止**在连接回调中执行耗时同步操作（阻塞事件循环）
- Pool 事件（`event`、`clientStateChange`）通过 `TypedEventEmitter` 分发，监听器应快速返回，耗时处理放入异步队列

## 排障节奏

遇到性能问题或 Bug 时，遵循以下节奏，**禁止猜测原因**：

1. **先看日志**：通过 pino 结构化日志定位问题链路
2. **复现问题**：在本地复现，记录最小复现步骤
3. **量化影响**：确认问题的频率、影响范围（是偶发还是系统性）
4. **修复验证**：修复后运行 `pnpm test` 和 `pnpm test:coverage` 确认覆盖率不下降
5. **测试优先**：新增针对该 bug 的回归测试，再提交修复代码

- **禁止**通过增加 `setTimeout` 来「规避」竞态条件，应从根本上修复并发问题
- **禁止**在测试中使用真实时间等待（`setTimeout`/`sleep`），应使用 vitest 的 `vi.useFakeTimers()`
