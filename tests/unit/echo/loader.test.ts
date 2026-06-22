import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, it, expect, afterEach } from 'vitest'

import type { EchoConfig, EchoValidator } from '../../../src'
import { EchoLoader } from '../../../src/echo'

/** 创建临时目录，返回路径。 */
async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'echo-loader-test-'))
}

describe('EchoLoader', () => {
  const tmpDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })))
    tmpDirs.length = 0
  })

  async function createTmpDir(): Promise<string> {
    const dir = await makeTmpDir()
    tmpDirs.push(dir)
    return dir
  }

  it('扫描目录中包含 .js 文件时返回 EchoEntry 列表', async () => {
    const tmpDir = await createTmpDir()
    await fs.writeFile(path.join(tmpDir, 'module-a.js'), 'export const name = "module-a";\n')
    await fs.writeFile(path.join(tmpDir, 'module-b.js'), 'export const name = "module-b";\n')

    const config: EchoConfig = { echoes: { handler: tmpDir } }
    const loader = new EchoLoader(config, '/')
    const result = await loader.discoverByType('handler')

    expect(result).toHaveLength(2)
    const names = result.map((e) => e.name).sort()
    expect(names).toEqual(['module-a', 'module-b'])
  })

  it('空目录返回空列表', async () => {
    const tmpDir = await createTmpDir()

    const config: EchoConfig = { echoes: { handler: tmpDir } }
    const loader = new EchoLoader(config, '/')
    const result = await loader.discoverByType('handler')

    expect(result).toHaveLength(0)
  })

  it('不存在的目录应记录警告并跳过（不抛出）', async () => {
    const nonExistentDir = path.join(os.tmpdir(), `definitely-does-not-exist-${Date.now()}`)
    const warnings: string[] = []
    const mockLogger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => {
        warnings.push(msg)
      },
      error: () => {},
    }

    const config: EchoConfig = { echoes: { handler: nonExistentDir } }
    const loader = new EchoLoader(config, '/', { logger: mockLogger })

    // 不应抛出
    const result = await loader.discoverByType('handler')
    expect(result).toHaveLength(0)
    expect(warnings.some((w) => w.includes('not found') || w.includes(nonExistentDir))).toBe(true)
  })

  it('exclude glob 过滤 — 被排除的文件不出现在结果中', async () => {
    const tmpDir = await createTmpDir()
    await fs.writeFile(path.join(tmpDir, 'included.js'), 'export const x = 1;\n')
    await fs.writeFile(path.join(tmpDir, 'excluded.test.js'), 'export const x = 2;\n')

    const config: EchoConfig = {
      echoes: {
        handler: { dir: tmpDir, exclude: ['*.test.js'] },
      },
    }
    const loader = new EchoLoader(config, '/')
    const result = await loader.discoverByType('handler')

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('included')
  })

  it('自定义 validator 拒绝时，entry 不出现在结果中', async () => {
    const tmpDir = await createTmpDir()
    await fs.writeFile(path.join(tmpDir, 'valid.js'), 'export const valid = true;\n')
    await fs.writeFile(path.join(tmpDir, 'invalid.js'), 'export const valid = false;\n')

    const validator: EchoValidator = {
      validate(mod: unknown): boolean {
        return (mod as Record<string, unknown>).valid === true
      },
    }

    const config: EchoConfig = { echoes: { handler: tmpDir } }
    const loader = new EchoLoader(config, '/', { validators: { handler: validator } })
    const result = await loader.discoverByType('handler')

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('valid')
  })

  it('加载失败的文件（语法错误）应被跳过', async () => {
    const tmpDir = await createTmpDir()
    await fs.writeFile(path.join(tmpDir, 'good.js'), 'export const x = 1;\n')
    await fs.writeFile(path.join(tmpDir, 'bad.js'), 'this is not valid javascript !!!;\n')

    const warnings: string[] = []
    const mockLogger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => {
        warnings.push(msg)
      },
      error: () => {},
    }

    const config: EchoConfig = { echoes: { handler: tmpDir } }
    const loader = new EchoLoader(config, '/', { logger: mockLogger })
    const result = await loader.discoverByType('handler')

    // 只有 good.js 成功加载
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('good')
  })

  it('discoverAll 返回所有类型的 EchoManifest', async () => {
    const handlerDir = await createTmpDir()
    const serviceDir = await createTmpDir()
    await fs.writeFile(path.join(handlerDir, 'h1.js'), 'export const x = 1;\n')
    await fs.writeFile(path.join(serviceDir, 's1.js'), 'export const x = 2;\n')

    const config: EchoConfig = {
      echoes: {
        handler: handlerDir,
        service: serviceDir,
      },
    }
    const loader = new EchoLoader(config, '/')
    const manifest = await loader.discoverAll()

    expect(manifest.entries.get('handler')).toHaveLength(1)
    expect(manifest.entries.get('service')).toHaveLength(1)
  })

  it('EchoEntry 包含正确的字段（type、name、path、module）', async () => {
    const tmpDir = await createTmpDir()
    await fs.writeFile(path.join(tmpDir, 'my-module.js'), 'export const hello = "world";\n')

    const config: EchoConfig = { echoes: { handler: tmpDir } }
    const loader = new EchoLoader(config, '/')
    const result = await loader.discoverByType('handler')

    expect(result).toHaveLength(1)
    const entry = result[0]
    expect(entry.type).toBe('handler')
    expect(entry.name).toBe('my-module')
    expect(entry.path).toContain('my-module.js')
    expect(entry.module).toBeTruthy()
    expect((entry.module as Record<string, unknown>).hello).toBe('world')
  })

  it('子目录中的文件也会被递归扫描', async () => {
    const tmpDir = await createTmpDir()
    const subDir = path.join(tmpDir, 'sub')
    await fs.mkdir(subDir)
    await fs.writeFile(path.join(tmpDir, 'top.js'), 'export const level = "top";\n')
    await fs.writeFile(path.join(subDir, 'nested.js'), 'export const level = "nested";\n')

    const config: EchoConfig = { echoes: { handler: tmpDir } }
    const loader = new EchoLoader(config, '/')
    const result = await loader.discoverByType('handler')

    expect(result).toHaveLength(2)
    const names = result.map((e) => e.name).sort()
    expect(names).toEqual(['nested', 'top'])
  })

  it('未配置 type 时返回空列表', async () => {
    const config: EchoConfig = { echoes: {} }
    const loader = new EchoLoader(config, '/')
    const result = await loader.discoverByType('handler')
    expect(result).toHaveLength(0)
  })
})
