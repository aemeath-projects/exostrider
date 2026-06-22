# 安全规则（强制执行）

本规则适用于所有代码变更，违反任何一条均为阻断性问题。

## Secrets 管理

- **禁止**在代码中硬编码任何密钥、token、密码、API key（包括测试代码）
- `.env`、`*.key`、`*_secret*` 文件必须列入 `.gitignore`，**绝不允许**提交到版本库
- 日志输出禁止打印敏感信息（pino 通过 `redact` 配置过滤）

## 动态导入安全（EchoLoader）

- `EchoLoader` 动态 `import()` 的路径必须由 `EchoConfig` 中的白名单目录限定
- **禁止**将用户可控的字符串直接拼接为 import 路径
- 扫描目录时只允许 `.ts`、`.js`、`.mts`、`.mjs` 后缀，拒绝其他文件类型

## 代码执行安全

- **禁止**使用 `eval()`、`Function()` 构造器、`vm.runInNewContext()` 处理任何外部数据
- Handler 方法和拦截器必须是静态声明的类方法，**禁止**运行时动态注册任意函数为处理器
- 装饰器元数据仅允许在模块加载期（装饰器副作用）写入，运行期只读

## 输入校验（事件分发边界）

- 外部事件进入 `EventDispatcher.dispatch()` 前，宿主（调用方）有责任对事件数据进行校验
- 库本身对 `TEvent` 泛型参数不做假设，但内部实现**禁止**将事件 payload 用于路径拼接、代码执行等危险操作
- `SessionManager.processMessage()` 接收的消息应视为不可信外部输入，状态机逻辑不得因非法输入崩溃

## 依赖安全

- 新增第三方依赖前，运行 `pnpm audit` 检查已知漏洞
- **禁止**使用 `eval()`、`Function()` 构造器、`vm.runInNewContext()` 处理任何来自外部的不可信数据
- 仅在 `devDependencies` 中使用构建/测试工具，**禁止**将开发工具泄漏到 `dependencies`（影响下游用户的 bundle size 和安全面）
- 发布前通过 `pnpm prepublishOnly`（已配置）自动执行 lint + type-check + test + build