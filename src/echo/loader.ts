/** 统一 Echo 组件发现与加载器。 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { minimatch } from 'minimatch'

import type { Logger } from '../types'

import type { EchoConfig } from './config'
import { normalizeEchoDirConfig } from './config'

/** 单个 Echo 模块条目。 */
export interface EchoEntry {
  readonly type: string
  readonly name: string
  readonly path: string
  readonly module: unknown
}

/** 所有类型的 Echo 扫描结果。 */
export interface EchoManifest {
  readonly entries: ReadonlyMap<string, readonly EchoEntry[]>
}

/** 自定义模块校验器，用于过滤不符合规范的模块。 */
export interface EchoValidator {
  validate(module: unknown, entry: EchoEntry): boolean
}

/** EchoLoader 构造选项。 */
export interface EchoLoaderOptions {
  readonly validators?: Record<string, EchoValidator>
  readonly logger?: Logger
}

/** Echo 模块发现与加载器。 */
export class EchoLoader {
  private readonly _config: EchoConfig
  private readonly _baseDir: string
  private readonly _validators: Partial<Record<string, EchoValidator>>
  private readonly _logger?: Logger

  constructor(config: EchoConfig, baseDir: string, options?: EchoLoaderOptions) {
    this._config = config
    this._baseDir = baseDir
    this._validators = options?.validators ?? {}
    this._logger = options?.logger
  }

  /** 扫描所有已配置类型的目录，返回聚合的 EchoManifest。 */
  async discoverAll(): Promise<EchoManifest> {
    const types = Object.keys(this._config.echoes)
    const results = await Promise.all(types.map((t) => this.discoverByType(t)))
    const entries = new Map(types.map((t, i) => [t, results[i]]))
    return { entries }
  }

  /** 扫描指定类型目录，返回该类型的 EchoEntry 列表。 */
  async discoverByType(type: string): Promise<readonly EchoEntry[]> {
    const rawConfig = this._config.echoes[type]
    if (!rawConfig) return []

    const { dir, exclude = [] } = normalizeEchoDirConfig(rawConfig)
    // 当 dir 是绝对路径时 path.resolve 不变；相对路径则相对 baseDir 解析
    const absDir = path.isAbsolute(dir) ? dir : path.resolve(this._baseDir, dir)

    // 检查目录是否存在
    try {
      await fs.access(absDir)
    } catch {
      this._logger?.warn(`Echo 扫描目录不存在: ${absDir}`)
      return []
    }

    // 递归扫描文件
    const files = await this._scanDir(absDir)
    const validator = this._validators[type]
    const results: EchoEntry[] = []

    for (const filePath of files) {
      const relPath = path.relative(absDir, filePath).replace(/\\/g, '/')

      // 应用排除规则
      if (exclude.some((pattern) => minimatch(relPath, pattern))) continue

      try {
        const mod: unknown = await import(pathToFileURL(filePath).href)
        const name = path.basename(filePath, path.extname(filePath))
        const entry: EchoEntry = { type, name, path: filePath, module: mod }

        // 应用自定义校验器
        if (validator && !validator.validate(mod, entry)) continue

        results.push(entry)
      } catch {
        this._logger?.warn(`加载模块失败: ${filePath}`)
      }
    }

    return results
  }

  /** 递归扫描目录，收集所有 .ts/.js/.mts/.mjs 文件（排除 .d.ts）。 */
  private async _scanDir(dir: string): Promise<string[]> {
    const files: string[] = []

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          const subFiles = await this._scanDir(fullPath)
          files.push(...subFiles)
        } else if (
          entry.isFile() &&
          /\.(ts|js|mts|mjs)$/.test(entry.name) &&
          !entry.name.endsWith('.d.ts')
        ) {
          files.push(fullPath)
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        this._logger?.warn(`读取目录失败: ${dir}: ${String(err)}`)
      }
      return files
    }

    return files
  }
}
