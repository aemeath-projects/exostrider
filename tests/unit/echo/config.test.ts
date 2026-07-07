import path from 'node:path'

import { describe, it, expect } from 'vitest'

import { defineConfig, normalizeEchoDirConfig, loadEchoConfig } from '../../../src/echo'

describe('defineConfig', () => {
  it('返回传入的配置对象（原样返回）', () => {
    const config = {
      echoes: {
        handler: { dir: 'src/handlers' },
        service: 'src/services',
      },
    }
    const result = defineConfig(config)
    expect(result).toBe(config)
  })

  it('支持空 echoes 对象', () => {
    const config = { echoes: {} }
    expect(defineConfig(config)).toBe(config)
  })
})

describe('normalizeEchoDirConfig', () => {
  it('字符串转换为 { dir: string }', () => {
    const result = normalizeEchoDirConfig('src/handlers')
    expect(result).toEqual({ dir: 'src/handlers' })
  })

  it('对象原样返回（无 exclude）', () => {
    const input = { dir: 'src/services' }
    const result = normalizeEchoDirConfig(input)
    expect(result).toBe(input)
  })

  it('对象原样返回（含 exclude）', () => {
    const input = { dir: 'src/tasks', exclude: ['**/*.test.ts'] }
    const result = normalizeEchoDirConfig(input)
    expect(result).toBe(input)
  })

  it('字符串转换不携带 exclude 字段', () => {
    const result = normalizeEchoDirConfig('src/apis')
    expect(result).not.toHaveProperty('exclude')
  })
})

describe('loadEchoConfig', () => {
  it('加载不存在的配置文件时应抛出错误', async () => {
    const nonExistentPath = path.resolve('/tmp/definitely-does-not-exist-12345/aemeath.config.ts')
    await expect(loadEchoConfig(nonExistentPath)).rejects.toThrow()
  })

  it('加载无 default 导出的文件时应抛出错误', async () => {
    // 创建一个临时的无 default 导出 JS 文件
    const os = await import('node:os')
    const fs = await import('node:fs/promises')
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echo-test-'))
    const configPath = path.join(tmpDir, 'bad-config.mjs')
    try {
      await fs.writeFile(configPath, 'export const foo = 1;\n')
      await expect(loadEchoConfig(configPath)).rejects.toThrow(/default 导出/)
    } finally {
      await fs.rm(tmpDir, { recursive: true })
    }
  })

  it('加载有效 default 导出的文件时返回配置对象', async () => {
    const os = await import('node:os')
    const fs = await import('node:fs/promises')
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echo-test-'))
    const configPath = path.join(tmpDir, 'valid-config.mjs')
    try {
      await fs.writeFile(configPath, 'export default { echoes: { handler: "src/handlers" } };\n')
      const result = await loadEchoConfig(configPath)
      expect(result).toEqual({ echoes: { handler: 'src/handlers' } })
    } finally {
      await fs.rm(tmpDir, { recursive: true })
    }
  })

  it('加载 default 导出不是对象的文件时应抛出错误', async () => {
    const os = await import('node:os')
    const fs = await import('node:fs/promises')
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echo-test-'))
    const configPath = path.join(tmpDir, 'string-config.mjs')
    try {
      await fs.writeFile(configPath, 'export default "not an object";\n')
      await expect(loadEchoConfig(configPath)).rejects.toThrow(/合法的 EchoConfig/)
    } finally {
      await fs.rm(tmpDir, { recursive: true })
    }
  })

  it('加载 default 导出无 echoes 字段时应抛出错误', async () => {
    const os = await import('node:os')
    const fs = await import('node:fs/promises')
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'echo-test-'))
    const configPath = path.join(tmpDir, 'no-echoes.mjs')
    try {
      await fs.writeFile(configPath, 'export default { foo: "bar" };\n')
      await expect(loadEchoConfig(configPath)).rejects.toThrow(/合法的 EchoConfig/)
    } finally {
      await fs.rm(tmpDir, { recursive: true })
    }
  })
})
