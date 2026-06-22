/** Echo 配置定义与工具函数。 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Echo 目录配置，支持排除 glob 模式。 */
export interface EchoDirConfig {
  readonly dir: string
  readonly exclude?: readonly string[]
}

/** EchoLoader 扫描配置。 */
export interface EchoConfig {
  readonly echoes: Record<string, EchoDirConfig | string>
}

/** 归一化：string → { dir: string }，对象原样返回。 */
export function normalizeEchoDirConfig(input: EchoDirConfig | string): EchoDirConfig {
  if (typeof input === 'string') return { dir: input }
  return input
}

/** 返回传入的配置对象（类型辅助函数）。 */
export function defineConfig(config: EchoConfig): EchoConfig {
  return config
}

/** 动态 import 配置文件，要求有 default 导出。 */
export async function loadEchoConfig(configPath: string): Promise<EchoConfig> {
  const resolved = path.resolve(configPath)
  let mod: unknown
  try {
    mod = await import(pathToFileURL(resolved).href)
  } catch (err) {
    throw new Error(`无法加载 Echo 配置文件 "${resolved}"`, { cause: err })
  }
  if (!mod || typeof mod !== 'object' || !('default' in mod) || !mod.default) {
    throw new Error(`配置文件 "${resolved}" 必须包含 default 导出`)
  }
  const cfg = mod.default
  if (typeof cfg !== 'object' || !('echoes' in cfg)) {
    throw new Error(`配置文件 "${resolved}" 的 default 导出必须是合法的 EchoConfig 对象`)
  }
  return cfg as EchoConfig
}
