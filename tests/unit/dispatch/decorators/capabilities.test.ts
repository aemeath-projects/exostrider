import { describe, it, expect } from 'vitest'

import {
  RequiresBotCapability,
  HANDLER_METHODS,
  getOrCreateMethodEntry,
} from '../../../../src/dispatch'
import type { BotCapability, MethodMetaEntry } from '../../../../src/dispatch'

function makeMethodCtx(
  name: string | symbol,
  metadata: Record<symbol, unknown>,
): ClassMethodDecoratorContext {
  return { name, metadata } as unknown as ClassMethodDecoratorContext
}

describe('RequiresBotCapability', () => {
  describe('基础写入', () => {
    it('将 group_admin 能力写入 MethodMetaEntry', () => {
      const metadata: Record<symbol, unknown> = {}
      RequiresBotCapability('group_admin')(undefined, makeMethodCtx('handleRevoke', metadata))

      const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
      const entry = methods.find((m) => m.methodName === 'handleRevoke')
      expect(entry?.requiredBotCapability).toBe('group_admin')
    })

    it('将 group_owner 能力写入 MethodMetaEntry', () => {
      const metadata: Record<symbol, unknown> = {}
      RequiresBotCapability('group_owner')(undefined, makeMethodCtx('handleOwnerOnly', metadata))

      const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
      const entry = methods.find((m) => m.methodName === 'handleOwnerOnly')
      expect(entry?.requiredBotCapability).toBe('group_owner')
    })

    it('无装饰器时 requiredBotCapability 默认为 null', () => {
      const metadata: Record<symbol, unknown> = {}
      const entry = getOrCreateMethodEntry(makeMethodCtx('handleNormal', metadata))
      expect(entry.requiredBotCapability).toBeNull()
    })

    it('所有合法 BotCapability 值均能被写入', () => {
      const caps: BotCapability[] = ['group_admin', 'group_owner']
      for (const cap of caps) {
        const metadata: Record<symbol, unknown> = {}
        RequiresBotCapability(cap)(undefined, makeMethodCtx('handle', metadata))
        const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
        expect(methods[0]?.requiredBotCapability).toBe(cap)
      }
    })
  })

  describe('覆盖行为', () => {
    it('同一方法连续两次应用装饰器，后者覆盖前者', () => {
      const metadata: Record<symbol, unknown> = {}
      const ctx = makeMethodCtx('handle', metadata)

      RequiresBotCapability('group_admin')(undefined, ctx)
      RequiresBotCapability('group_owner')(undefined, ctx)

      const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
      const entries = methods.filter((m) => m.methodName === 'handle')
      expect(entries).toHaveLength(1)
      expect(entries[0].requiredBotCapability).toBe('group_owner')
    })

    it('同一方法重复应用相同 capability 不产生重复 entry', () => {
      const metadata: Record<symbol, unknown> = {}
      const ctx = makeMethodCtx('handle', metadata)

      RequiresBotCapability('group_admin')(undefined, ctx)
      RequiresBotCapability('group_admin')(undefined, ctx)

      const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
      expect(methods.filter((m) => m.methodName === 'handle')).toHaveLength(1)
    })
  })

  describe('多方法元数据隔离', () => {
    it('同一 metadata 下两个方法各自有独立的 capability', () => {
      const metadata: Record<symbol, unknown> = {}
      RequiresBotCapability('group_admin')(undefined, makeMethodCtx('methodA', metadata))
      RequiresBotCapability('group_owner')(undefined, makeMethodCtx('methodB', metadata))

      const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
      const entryA = methods.find((m) => m.methodName === 'methodA')
      const entryB = methods.find((m) => m.methodName === 'methodB')

      expect(entryA?.requiredBotCapability).toBe('group_admin')
      expect(entryB?.requiredBotCapability).toBe('group_owner')
    })

    it('有 capability 和无 capability 的方法共存时互不干扰', () => {
      const metadata: Record<symbol, unknown> = {}
      RequiresBotCapability('group_admin')(undefined, makeMethodCtx('restricted', metadata))
      getOrCreateMethodEntry(makeMethodCtx('open', metadata))

      const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
      const restricted = methods.find((m) => m.methodName === 'restricted')
      const open = methods.find((m) => m.methodName === 'open')

      expect(restricted?.requiredBotCapability).toBe('group_admin')
      expect(open?.requiredBotCapability).toBeNull()
    })

    it('不同 metadata 对象之间的 capability 完全隔离', () => {
      const metaA: Record<symbol, unknown> = {}
      const metaB: Record<symbol, unknown> = {}

      RequiresBotCapability('group_admin')(undefined, makeMethodCtx('handle', metaA))
      getOrCreateMethodEntry(makeMethodCtx('handle', metaB))

      const methodsA = metaA[HANDLER_METHODS] as MethodMetaEntry[]
      const methodsB = metaB[HANDLER_METHODS] as MethodMetaEntry[]

      expect(methodsA.find((m) => m.methodName === 'handle')?.requiredBotCapability).toBe(
        'group_admin',
      )
      expect(methodsB.find((m) => m.methodName === 'handle')?.requiredBotCapability).toBeNull()
    })

    it('同一 metadata 下多个方法按注册顺序保存在 methods 数组中', () => {
      const metadata: Record<symbol, unknown> = {}
      const names = ['methodA', 'methodB', 'methodC']
      for (const name of names) {
        RequiresBotCapability('group_admin')(undefined, makeMethodCtx(name, metadata))
      }

      const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
      expect(methods).toHaveLength(3)
      expect(methods.map((m) => m.methodName)).toEqual(names)
    })
  })

  describe('entry 字段完整性', () => {
    it('RequiresBotCapability 不破坏 entry 的其他默认字段', () => {
      const metadata: Record<symbol, unknown> = {}
      RequiresBotCapability('group_admin')(undefined, makeMethodCtx('handle', metadata))

      const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
      const entry = methods[0]

      expect(entry.methodName).toBe('handle')
      expect(entry.mappingType).toBe('command')
      expect(entry.permission).toBe(0)
      expect(entry.scope).toBe('all')
      expect(entry.priority).toBeNull()
      expect(entry.interceptors).toEqual([])
    })

    it('与 getOrCreateMethodEntry 返回同一 entry 对象（可被多个装饰器共享修改）', () => {
      const metadata: Record<symbol, unknown> = {}
      const ctx = makeMethodCtx('handle', metadata)

      const entryFromUtil = getOrCreateMethodEntry(ctx)
      RequiresBotCapability('group_owner')(undefined, ctx)

      const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
      const entryFromMeta = methods.find((m) => m.methodName === 'handle')

      expect(entryFromMeta).toBe(entryFromUtil)
      expect(entryFromUtil.requiredBotCapability).toBe('group_owner')
    })
  })

  describe('边界条件', () => {
    it('metadata 为 null 时 getOrCreateMethodEntry 抛出含方法名的错误', () => {
      const ctx = {
        name: 'handle',
        metadata: null,
      } as unknown as ClassMethodDecoratorContext

      expect(() => getOrCreateMethodEntry(ctx)).toThrow('[dispatch]')
      expect(() => getOrCreateMethodEntry(ctx)).toThrow('handle')
    })

    it('metadata 为 undefined 时也抛出错误', () => {
      const ctx = {
        name: 'myMethod',
        metadata: undefined,
      } as unknown as ClassMethodDecoratorContext

      expect(() => getOrCreateMethodEntry(ctx)).toThrow('[dispatch]')
    })

    it('Symbol 名称的方法也能正确记录 capability', () => {
      const metadata: Record<symbol, unknown> = {}
      const sym = Symbol('handleSym')
      RequiresBotCapability('group_owner')(undefined, makeMethodCtx(sym, metadata))

      const methods = metadata[HANDLER_METHODS] as MethodMetaEntry[]
      const entry = methods.find((m) => m.methodName === sym)
      expect(entry?.requiredBotCapability).toBe('group_owner')
    })

    it('HANDLER_METHODS 数组初始不存在时由装饰器自动创建', () => {
      const metadata: Record<symbol, unknown> = {}
      expect(metadata[HANDLER_METHODS]).toBeUndefined()

      RequiresBotCapability('group_admin')(undefined, makeMethodCtx('handle', metadata))

      expect(Array.isArray(metadata[HANDLER_METHODS])).toBe(true)
    })
  })
})
