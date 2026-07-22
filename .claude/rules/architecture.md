# 架构与职责边界规则（强制执行）

补充 CLAUDE.md 中的六模块架构说明，约定跨模块/跨文件的结构性问题。

## 模块边界（SRP）

- 六个模块（`echo`/`lifecycle`/`dispatch`/`session`/`logger`/`pool`）之间只允许通过各自 `index.ts` 的导出 API 交互，禁止跨模块深层导入内部实现文件
- `src/types/` 中的接口不得导入任何其他模块的内容（避免循环依赖）

## 禁止局部重复实现

- 已存在跨模块复用的工具函数时（如按 injects 元数据赋值服务实例的逻辑），禁止在多个模块各自重新实现一遍相近逻辑
- 发现重复实现，抽取为公开工具函数并从对应模块 `index.ts` 导出，各消费方改为调用该函数

## 全局单例生命周期

- `handlerRegistry`、`serviceEntryRegistry` 是进程级全局单例，`startup` 完成后必须调用 `freeze()` 禁止运行期修改
- 测试文件中每个 `beforeEach` 必须调用 `handlerRegistry.clear()`，防止测试间状态污染（属于结构问题而非测试质量问题——全局单例污染会导致测试结果依赖执行顺序）

## 装饰器契约

- `@Handler` 类装饰器与方法路由装饰器（`@OnCommand` 等）必须配对使用
- 装饰器副作用（写入全局注册表）必须幂等，重复执行不得产生副作用或报错
- 路由装饰器元数据统一通过 `src/dispatch/decorators/symbols.ts` 定义的 Symbol key 存储，禁止在其他位置新建等价的 Symbol 定义
