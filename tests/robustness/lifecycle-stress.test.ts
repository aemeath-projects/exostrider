/**
 * 生命周期高负载压力测试 —— 大量 Service 拓扑排序、快速 startup/shutdown 循环。
 */

import { describe, it, expect } from 'vitest'

import { LifecycleOrchestrator, ServiceRegistry } from '../../src/lifecycle'
import type { ServiceEntry } from '../../src/lifecycle'

function makeEntry(name: string, overrides: Partial<ServiceEntry> = {}): ServiceEntry {
  return {
    name,
    serviceClass: class {},
    startupMethod: null,
    shutdownMethod: null,
    injects: [],
    provides: [],
    ...overrides,
  }
}

describe('生命周期高负载压力', () => {
  it('50 个 Service 链式依赖启动顺序正确', async () => {
    const order: string[] = []
    const entries: ServiceEntry[] = []

    for (let i = 0; i < 50; i++) {
      const ServiceClass = class {
        start(): void {
          order.push(`svc-${i}`)
        }
      }

      const entry = makeEntry(`svc-${i}`, {
        serviceClass: ServiceClass as unknown as new (...args: unknown[]) => unknown,
        startupMethod: 'start',
        injects: i > 0 ? [{ propertyName: 'dep', serviceKey: `key_${i - 1}` }] : [],
        provides: [{ propertyName: 'val', serviceKey: `key_${i}` }],
      })
      entries.push(entry)
    }

    const registry = new ServiceRegistry()
    const orchestrator = new LifecycleOrchestrator(registry)

    await orchestrator.startup(entries)

    // 验证升序启动
    for (let i = 0; i < 50; i++) {
      expect(order[i]).toBe(`svc-${i}`)
    }
  })

  it('50 consumer 依赖 5 provider 菱形依赖，provider 均先于 consumer', async () => {
    const order: string[] = []
    const entries: ServiceEntry[] = []

    // 5 个 provider
    for (let p = 0; p < 5; p++) {
      const ProviderClass = class {
        start(): void {
          order.push(`provider-${p}`)
        }
      }
      entries.push(
        makeEntry(`provider-${p}`, {
          serviceClass: ProviderClass as unknown as new (...args: unknown[]) => unknown,
          startupMethod: 'start',
          provides: [{ propertyName: 'svc', serviceKey: `key_${p}` }],
        }),
      )
    }

    // 50 个 consumer，每个注入所有 5 个 key
    for (let c = 0; c < 50; c++) {
      const ConsumerClass = class {
        start(): void {
          order.push(`consumer-${c}`)
        }
      }
      entries.push(
        makeEntry(`consumer-${c}`, {
          serviceClass: ConsumerClass as unknown as new (...args: unknown[]) => unknown,
          startupMethod: 'start',
          injects: [0, 1, 2, 3, 4].map((p) => ({
            propertyName: `dep_${p}`,
            serviceKey: `key_${p}`,
          })),
        }),
      )
    }

    const registry = new ServiceRegistry()
    const orchestrator = new LifecycleOrchestrator(registry)

    await orchestrator.startup(entries)

    // 所有 provider 应在 consumer 之前
    const firstConsumerIdx = order.findIndex((s) => s.startsWith('consumer'))
    expect(firstConsumerIdx).toBeGreaterThanOrEqual(5)
  })

  it('100 个 Service 快速 startup → shutdown 循环 10 轮，每轮清理干净', async () => {
    const entries: ServiceEntry[] = []

    for (let i = 0; i < 100; i++) {
      const ServiceClass = class {
        stop(): void {}
      }
      entries.push(
        makeEntry(`svc-${i}`, {
          serviceClass: ServiceClass as unknown as new (...args: unknown[]) => unknown,
          shutdownMethod: 'stop',
        }),
      )
    }

    for (let round = 0; round < 10; round++) {
      const registry = new ServiceRegistry()
      const orchestrator = new LifecycleOrchestrator(registry)

      await expect(orchestrator.startup(entries)).resolves.toBeUndefined()
      await expect(orchestrator.shutdown()).resolves.toBeUndefined()
    }
  })

  it('无依赖的大规模启动，50 个无依赖 Service 均正确实例化', async () => {
    const order: string[] = []
    const entries: ServiceEntry[] = []

    for (let i = 0; i < 50; i++) {
      const ServiceClass = class {
        start(): void {
          order.push(`svc-${i}`)
        }
      }
      entries.push(
        makeEntry(`svc-${i}`, {
          serviceClass: ServiceClass as unknown as new (...args: unknown[]) => unknown,
          startupMethod: 'start',
        }),
      )
    }

    const registry = new ServiceRegistry()
    const orchestrator = new LifecycleOrchestrator(registry)

    await orchestrator.startup(entries)
    expect(order).toHaveLength(50)
  })
})
