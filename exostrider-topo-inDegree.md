# 链路编排器拓扑排序 inDegree 重复计数导致启动失败

> 涉及包：`@aemeath-projects/exostrider@1.1.2`  
> 触发条件：一个 `@Service` 类向同一个 provider 注入了 ≥2 个不同 serviceKey  
> 当前触发：`daily_checkin_bootstrap`（2025-07）

## 现象

启动后端时 `LifecycleOrchestrator.startup()` 抛出：

```
循环依赖或未满足依赖检测到: daily_checkin_bootstrap
```

## 根因分析

### 依赖链

`DailyCheckinBootstrap` 的 `@Inject` 声明：

```
@Inject('db')          → 基础设施（预注册，不计入度）
@Inject('cache')        → 基础设施（预注册，不计入度）
@Inject('master_apis')  → 由 multi_account_bootstrap 提供
@Inject('account_pool') → 由 multi_account_bootstrap 提供   ← 与上条同一 provider
@Inject('settings')     → 由 settings_bootstrap 提供
```

`multi_account_bootstrap` 同时 `@Provide('master_apis')` 和 `@Provide('account_pool')`。  
`daily_checkin_bootstrap` 对这两个 key 分别 `@Inject`。

### Kahn 算法中的 bug

`LifecycleOrchestrator._topoSort()` 位于 `src/lifecycle/orchestrator.ts`，构建入度表的逻辑：

```typescript
// 当前实现（有 bug）
for (const entry of entries) {
  for (const inject of entry.injects) {
    const provider = provideMap.get(inject.serviceKey)
    if (provider !== undefined && provider !== entry.name) {
      const providerSet = adj.get(provider)
      if (providerSet) providerSet.add(entry.name)         // Set.add 去重，边只建一条
      inDegree.set(entry.name, (inDegree.get(entry.name) ?? 0) + 1)  // 但入度每次都 +1
    }
  }
}
```

遍历 `daily_checkin_bootstrap` 的 injects 时：

| 遍历到的 inject    | provider                 | 邻接边 Set                          | inDegree 变化 |
| ------------------ | ------------------------ | ----------------------------------- | ------------- |
| `master_apis`      | `multi_account_bootstrap` | `{daily_checkin_bootstrap}` (新增)  | 0 → 1         |
| `account_pool`     | `multi_account_bootstrap` | `{daily_checkin_bootstrap}` (已存在) | 1 → **2**     |
| `settings`         | `settings_bootstrap`      | `{daily_checkin_bootstrap}` (新增)  | 2 → **3**     |

最终 `daily_checkin_bootstrap` 的 **inDegree = 3**，但实际只有 2 条入边（`multi_account_bootstrap` → `daily_checkin_bootstrap`、`settings_bootstrap` → `daily_checkin_bootstrap`）。

Kahn BFS 阶段：每个 provider 完成时对其所有邻接节点 inDegree 减 1：

- `multi_account_bootstrap` 完成 → `daily_checkin_bootstrap` inDegree: 3 → **2**
- `settings_bootstrap` 完成 → `daily_checkin_bootstrap` inDegree: 2 → **1**

inDegree 始终 > 0，无法入队，最终留在未解析集合中触发异常。

### 修复前（minified JS）

`node_modules/@aemeath-projects/exostrider/dist/chunk-5WEKY42F.js` 中对应代码：

```js
for(let n of e)for(let s of n.injects){let c=t.get(s.serviceKey);if(c!==void 0&&c!==n.name){let f=a.get(c);f&&f.add(n.name),o.set(n.name,(o.get(n.name)??0)+1);}}
```

转换为可读形式：

```js
for (let n of e)
  for (let s of n.injects) {
    let c = t.get(s.serviceKey)
    if (c !== void 0 && c !== n.name) {
      let f = a.get(c)
      f && f.add(n.name), o.set(n.name, (o.get(n.name) ?? 0) + 1)   // 无条件 +1
    }
  }
```

## 通用触发条件

任意 `@Service` 类满足以下条件时触发：

1. 声明了 ≥2 个 `@Inject` 字段
2. 这些字段指向的 serviceKey 由 **同一个** `@Service` 类 `@Provide`

仅注入基础设施 key（`db`、`cache`、`queue` 等——预注册不进 provideMap）不计入此条件。

## 影响范围（当前代码库）

| Bootstrap                 | 注入的 provider key（排除基础设施）         | 同一 provider ≥2 个？ | 受影响？ |
| ------------------------- | ------------------------------------------- | -------------------- | -------- |
| `daily_checkin_bootstrap` | `master_apis`、`account_pool`、`settings`    | ✅ `multi_account_bootstrap` 提供前两者 | **是** |
| `like_bootstrap`          | `master_apis`                               | ❌ 仅一个             | 否       |
| `settings_bootstrap`      | `personnelService`                          | ❌ 仅一个             | 否       |
| `feedback_bootstrap`      | `message_router`                            | ❌ 仅一个             | 否       |
| `iris_bootstrap`          | `oss`、`media_storage`、`queue`             | ❌ 各来自不同 provider | 否       |
| 其他                     | —                                           | ❌                    | 否       |

> 当前仅 `daily_checkin_bootstrap` 命中此 bug。

## 框架层修复方案

### TypeScript 源码修复

文件：`packages/exostrider/src/lifecycle/orchestrator.ts`（exostrider 仓库内）

在 `_topoSort()` 的 inDegree 累加前增加 `providerSet.has()` 守卫：

```diff
 for (const entry of entries) {
   for (const inject of entry.injects) {
     const provider = provideMap.get(inject.serviceKey)
     if (provider !== undefined && provider !== entry.name) {
       const providerSet = adj.get(provider)
-      if (providerSet) providerSet.add(entry.name)
-      inDegree.set(entry.name, (inDegree.get(entry.name) ?? 0) + 1)
+      if (providerSet && !providerSet.has(entry.name)) {
+        providerSet.add(entry.name)
+        inDegree.set(entry.name, (inDegree.get(entry.name) ?? 0) + 1)
+      }
     }
   }
 }
```

### 临时 patch（node_modules）

在 exostrider 发新版前，可直接 patch 已安装的 minified JS。

文件：`node_modules/@aemeath-projects/exostrider/dist/chunk-5WEKY42F.js`

找到：

```js
f&&f.add(n.name),o.set(n.name,(o.get(n.name)??0)+1);
```

替换为：

```js
if(f){let d=f.has(n.name);f.add(n.name);if(!d)o.set(n.name,(o.get(n.name)??0)+1)}
```

> ⚠️ 此 patch 在 `pnpm install` 后丢失，仅作临时验证用。正式修复应发布 exostrider 新版本。

## 应用层规避方案

无需等待 exostrider 修复，可通过减少同源注入数量绕过。

`DailyCheckinService` 同时需要 `account_pool`（检查可用客户端）和 `groupApi`（发送群签到），二者可统一从 pool 获取：

```typescript
// daily-checkin.ts —— DailyCheckinBootstrap 修改后

@Service({ name: 'daily_checkin_bootstrap' })
export class DailyCheckinBootstrap {
  @Inject('db')
  db!: MainPrismaClient

  @Inject('cache')
  cache!: RedisStore

  /** 只注入 account_pool，移除 master_apis */
  @Inject('account_pool')
  pool!: AccountPool

  @Inject('settings')
  settings!: SettingsService

  @Provide('daily_checkin_service')
  dailyCheckinService!: DailyCheckinService

  @Startup
  start(): void {
    // 从 pool 中取主账号 client 动态构建 GroupApi
    const masterClients = this.pool.getClientsByRole('master')
    const masterClient = (masterClients[0] as NapCatClientAdapter).client
    const groupApi = new GroupApi(masterClient)

    this.dailyCheckinService = new DailyCheckinService(
      this.db,
      this.cache,
      groupApi,
      this.pool,
      this.settings,
    )
  }
}
```

需要额外导入：

```typescript
import { GroupApi } from '@aemeath-projects/napcat'
import { NapCatClientAdapter } from '@/core/accounts/adapter.js'
```

> 此方案消除了对 `master_apis` 的注入，使 `daily_checkin_bootstrap` 对 `multi_account_bootstrap` 的依赖从 2 个 key 减少为 1 个，不再触发 inDegree 重复计数 bug。
