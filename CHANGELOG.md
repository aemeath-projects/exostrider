# Changelog

所有版本变更记录

## [1.1.6](https://github.com/aemeath-projects/exostrider/compare/v1.1.5...v1.1.6) (2026-07-08)


### 重构

* 强制 barrel 文件导入并移除 prepublishOnly 脚本 ([a50b894](https://github.com/aemeath-projects/exostrider/commit/a50b894f601fb8c6dd01ebf464b5f6c2f28c86c1))

## [1.1.5](https://github.com/aemeath-projects/exostrider/compare/v1.1.4...v1.1.5) (2026-07-04)


### 重构

* **dispatch:** 移除 SettingNode 装饰器机制，恢复框架抽象边界 ([5aa8828](https://github.com/aemeath-projects/exostrider/commit/5aa8828146af4d8fa077d9003546047420fb335a))

## [1.1.4](https://github.com/aemeath-projects/exostrider/compare/v1.1.3...v1.1.4) (2026-06-24)


### 新功能

* **logger:** 实现 Spring Boot 风格 console 日志输出 ([c2f9a40](https://github.com/aemeath-projects/exostrider/commit/c2f9a403056a5f58e98b70960f2b3a9406526a44))

## [1.1.3](https://github.com/aemeath-projects/exostrider/compare/v1.1.2...v1.1.3) (2026-06-24)


### 新功能

* **logger:** 添加 Windows 终端兼容层（chcp 65001 + ANSI 检测） ([5f79f99](https://github.com/aemeath-projects/exostrider/commit/5f79f99648ab873db44b67a44f06556814c19044))


### Bug 修复

* **lifecycle:** 修复拓扑排序中同一 provider 多 serviceKey 的 inDegree 重复计数 ([18054f3](https://github.com/aemeath-projects/exostrider/commit/18054f399e1c68a1d2dd3ce77bd05a86ad497fbf))


### 文档

* 更新changelog ([21de33a](https://github.com/aemeath-projects/exostrider/commit/21de33a6b775580171415e51b77f6bcf300952ee))

## [1.1.2](https://github.com/aemeath-projects/exostrider/compare/v1.1.1...v1.1.2) (2026-06-24)


### 新功能

* **dispatch:** 添加 @RequiresBotCapability 装饰器，支持 Bot 群内权限声明 ([d177051](https://github.com/aemeath-projects/exostrider/commit/d177051045f3ea3a078747d3ca4ce1ead7975c3c))


### Bug 修复

* **dispatch:** 全局拦截器阻断时不再调用声明式拦截器的 afterCompletion ([4c47be5](https://github.com/aemeath-projects/exostrider/commit/4c47be5f44de86efa8c4ba20baf82704a5577a98))

## [1.1.1](https://github.com/aemeath-projects/exostrider/compare/v1.1.0...v1.1.1) (2026-06-23)


### 新功能

* **pool:** 完善 Pool 生命周期与客户端事件绑定 ([4e079c5](https://github.com/aemeath-projects/exostrider/commit/4e079c54da0d69be34b03c5a0357a47e2c710040))

## [1.1.0](https://github.com/aemeath-projects/exostrider/compare/v1.0.1...v1.1.0) (2026-06-23)


### 新功能

* **pool:** 集成 pool 生命周期管理，完善 ClientPool API 与测试覆盖 ([7ab7b95](https://github.com/aemeath-projects/exostrider/commit/7ab7b959806a19ad44893a95f0d9da777d1893d2))
* **pool:** 新增 pool 模块，支持客户端池管理和负载均衡 ([8da5183](https://github.com/aemeath-projects/exostrider/commit/8da5183430a517d00dd47f17ad4ee23690e71cb7))


### 文档

* 更新框架文档与包元数据，反映 Pool 模块功能 ([bade746](https://github.com/aemeath-projects/exostrider/commit/bade7465c6150e1aa31722d46932270c6fea13be))
* 更新codecov badge ([9c7c1c6](https://github.com/aemeath-projects/exostrider/commit/9c7c1c6f96ebe2972dd1cd882b9a1a481ffdb219))

## [1.0.1](https://github.com/aemeath-projects/exostrider/compare/v1.0.0...v1.0.1) (2026-06-22)


### 重构

* **core:** 统一导入规范与代码风格规则 ([8fe592f](https://github.com/aemeath-projects/exostrider/commit/8fe592f21afd169b5608e1660eba99aca7e69c45))

## 1.0.0 (2026-06-22)


### 新功能

* **core:** 初始化 Exostrider 事件驱动框架库 ([7784cf7](https://github.com/aemeath-projects/exostrider/commit/7784cf78fe482cb22d85d09085b17a120611d518))
