# 编码风格规则（强制执行）

补充 CLAUDE.md 中的架构说明，约定代码组织和质量底线。本项目是纯 TypeScript 库（ESM only），以下规则均针对库开发场景。

## 不可变优先

- 优先使用 `readonly` 修饰数组/对象成员：`readonly items: string[]`
- 模块级常量使用 `as const`：`const PRIORITY = { COMMAND: 10 } as const`
- 纯数据对象使用 `Object.freeze()` 或 `readonly` 接口
- 全局单例注册表（`handlerRegistry`、`serviceEntryRegistry`）在 `startup` 完成后调用 `freeze()` 禁止修改

## 模块结构（库架构）

本库分为五个独立模块，新文件必须放在对应模块目录下：

| 模块        | 目录               | 职责                                              |
| ----------- | ------------------ | ------------------------------------------------- |
| Echo        | `src/echo/`        | 目录扫描与动态 import，触发装饰器副作用           |
| Lifecycle   | `src/lifecycle/`   | 服务注册、拓扑排序、依赖注入、启动/关闭编排       |
| Dispatch    | `src/dispatch/`    | 路由映射、Handler 实例化、拦截器链、事件分发      |
| Session     | `src/session/`     | 会话管理、状态机、超时取消                        |
| Logger      | `src/logger/`      | pino 封装、全局注入、日志广播                     |
| 公共类型    | `src/types/`       | 泛型接口、共享类型定义，**禁止**包含业务逻辑      |
| 门面        | `src/index.ts`     | `Exostrider` 类，组装五个模块，进程单实例         |

- 模块之间只通过各自 `index.ts` 的导出 API 交互，**禁止**跨模块引用内部实现文件
- `src/types/` 中的接口不得导入任何其他模块（避免循环依赖）

## 装饰器规范（TC39 Stage 3）

- 使用 `ClassMethodDecoratorContext` / `ClassDecoratorContext`，**禁止**使用旧版 `experimentalDecorators`
- 装饰器副作用（写入全局注册表）必须幂等，重复执行不得产生副作用
- Handler 类装饰器与方法路由装饰器必须配对使用：有 `@Handler` 类才能有 `@OnCommand` 等方法装饰器
- 路由装饰器元数据通过 `Symbol` key 存储，Symbol 统一在 `src/dispatch/decorators/symbols.ts` 定义

## 全局单例隔离

- `handlerRegistry` 和 `serviceEntryRegistry` 是进程级全局单例
- **测试文件中每个 `beforeEach` 必须调用 `handlerRegistry.clear()`**，防止测试间状态污染
- 生产代码中 `Exostrider` 设计为单实例，**禁止**在同一进程中多次实例化

## 错误处理

- 使用 `src/dispatch/errors.ts` 中定义的异常类，**禁止**直接 `throw new Error('...')`
- `FinishError` 视为正常终止信号，不向 `afterCompletion` 传递 error 参数
- **禁止裸 `catch (e)`** 后静默吞错；需兜底时通过注入的 logger 记录
- Promise 拒绝必须被 `await` 捕获或通过 `.catch()` 处理；**禁止** `void somePromise()` 忽略错误

## 导入规范（ESM Strict）

- `src/` 内部所有模块导入**必须**使用 `.js` 后缀（tsup 编译后兼容）：`import { foo } from './foo.js'`
- 类型专用导入必须使用 `import type`：`import type { Bar } from './bar.js'`
- **禁止**循环依赖；如有循环请通过依赖注入或接口抽象解耦
- 导入顺序：Node 内建（`node:` 前缀）→ 第三方库 → 项目内部（ESLint `import-x` 规则自动排序）

## 命名规范

| 场景                       | 规则             | 示例                                              |
| -------------------------- | ---------------- | ------------------------------------------------- |
| 变量/函数/方法             | `camelCase`      | `buildMappings()`, `sessionKey`                   |
| 类/接口/类型/枚举          | `PascalCase`     | `EventDispatcher`, `HandlerMapping`               |
| 常量                       | `UPPER_SNAKE`    | `MAX_RETRY`, `DEFAULT_TIMEOUT_MS`                 |
| 模块级 Symbol              | `camelCase`      | `handlerMetaKey`, `interceptorSymbol`             |
| 装饰器函数                 | `PascalCase`     | `@Handler`, `@OnCommand`, `@Inject`               |
| 测试文件                   | `<name>.test.ts` | `mapping.test.ts`, `session-stress.test.ts`       |

## 公共 API 文档

- `src/*/index.ts` 中导出的类和函数必须附带中文 JSDoc 说明
- 泛型参数（如 `TEvent`、`TApis`）必须在 JSDoc 中说明约束和宿主传入方式
- **禁止**提交 TODO/FIXME 注释，未完成的工作应开 Issue 追踪