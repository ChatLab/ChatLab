/**
 * Parser V2 - 嗅探层
 * 负责检测文件格式，匹配对应的解析器
 */

import * as fs from 'fs'
import * as path from 'path'
import type { FormatFeature, FormatModule, Parser } from './types'

/** 文件头检测大小 (64KB) - 考虑到现代聊天记录文件可能包含 base64 头像等大数据 */
const HEAD_SIZE = 64 * 1024

/**
 * 读取文件头部内容
 */
function readFileHead(filePath: string, size: number = HEAD_SIZE): string {
  const fd = fs.openSync(filePath, 'r')
  const buffer = Buffer.alloc(size)
  const bytesRead = fs.readSync(fd, buffer, 0, size, 0)
  fs.closeSync(fd)
  return buffer.slice(0, bytesRead).toString('utf-8')
}

/**
 * 获取文件扩展名（小写）
 */
function getExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase()
}

/**
 * 检查文件头是否匹配签名
 */
function matchHeadSignatures(headContent: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(headContent))
}

/**
 * 检查文件名是否匹配签名
 */
function matchFilenameSignatures(filePath: string, patterns: RegExp[]): boolean {
  const filename = path.basename(filePath)
  return patterns.some((pattern) => pattern.test(filename))
}

/**
 * 文件名只能作为补充特征；需要全文确认时再读取完整文件。
 */
function matchFilenameFallbackPatterns(filePath: string, patterns: RegExp[]): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return patterns.every((pattern) => pattern.test(content))
  } catch {
    return false
  }
}

/**
 * 检查必需字段是否存在
 */
function matchRequiredFields(headContent: string, fields: string[]): boolean {
  // 简单检查：字段名是否出现在文件头中
  // 对于 JSON 文件，检查 "fieldName" 是否存在
  return fields.every((field) => {
    const pattern = new RegExp(`"${field.replace('.', '"\\s*:\\s*.*"')}"\\s*:`)
    return pattern.test(headContent) || headContent.includes(`"${field}"`)
  })
}

/**
 * 格式嗅探器
 * 管理所有格式特征，负责检测文件格式
 */
export class FormatSniffer {
  private formats: FormatModule[] = []

  /**
   * 注册格式模块
   */
  register(module: FormatModule): void {
    this.formats.push(module)
    // 按优先级排序（优先级数字越小越靠前）
    this.formats.sort((a, b) => a.feature.priority - b.feature.priority)
  }

  /**
   * 批量注册格式模块
   */
  registerAll(modules: FormatModule[]): void {
    for (const module of modules) {
      this.register(module)
    }
  }

  /**
   * 嗅探文件格式
   * @param filePath 文件路径
   * @returns 匹配的格式特征，如果无法识别则返回 null
   */
  sniff(filePath: string): FormatFeature | null {
    const ext = getExtension(filePath)
    const headContent = readFileHead(filePath)

    for (const { feature } of this.formats) {
      if (this.matchFeature(feature, ext, headContent, filePath)) {
        return feature
      }
    }

    return null
  }

  /**
   * 获取文件对应的解析器
   * @param filePath 文件路径
   * @returns 匹配的解析器，如果无法识别则返回 null
   */
  getParser(filePath: string): Parser | null {
    const ext = getExtension(filePath)
    const headContent = readFileHead(filePath)

    for (const { feature, parser } of this.formats) {
      if (this.matchFeature(feature, ext, headContent, filePath)) {
        return parser
      }
    }

    return null
  }

  /**
   * 嗅探所有匹配的格式（按优先级排序）
   * 用于 fallback 机制：当第一个格式解析失败时尝试下一个
   * @param filePath 文件路径
   * @returns 所有匹配的格式特征列表
   */
  sniffAll(filePath: string): FormatFeature[] {
    const ext = getExtension(filePath)
    const headContent = readFileHead(filePath)
    const results: FormatFeature[] = []

    for (const { feature } of this.formats) {
      if (this.matchFeature(feature, ext, headContent, filePath)) {
        results.push(feature)
      }
    }

    return results
  }

  /**
   * 获取所有匹配的解析器（按优先级排序）
   * 用于 fallback 机制
   * @param filePath 文件路径
   * @returns 所有匹配的解析器列表
   */
  getParserCandidates(filePath: string): Parser[] {
    const ext = getExtension(filePath)
    const headContent = readFileHead(filePath)
    const results: Parser[] = []

    for (const { feature, parser } of this.formats) {
      if (this.matchFeature(feature, ext, headContent, filePath)) {
        results.push(parser)
      }
    }

    return results
  }

  /**
   * 根据格式 ID 获取解析器
   */
  getParserById(formatId: string): Parser | null {
    const module = this.formats.find((m) => m.feature.id === formatId)
    return module?.parser || null
  }

  /**
   * 获取所有支持的格式
   */
  getSupportedFormats(): FormatFeature[] {
    return this.formats.map((m) => m.feature)
  }

  /**
   * 检查特征是否匹配
   */
  private matchFeature(feature: FormatFeature, ext: string, headContent: string, filePath?: string): boolean {
    // 1. 检查扩展名
    if (!feature.extensions.includes(ext)) {
      return false
    }

    const { signatures } = feature

    // 2. 检查文件头签名（如果定义了）
    let headMatch = true
    if (signatures.head && signatures.head.length > 0) {
      headMatch = matchHeadSignatures(headContent, signatures.head)
    }

    // 3. 检查文件名签名（如果定义了，作为文件头匹配失败的补充）
    let filenameMatch = false
    if (signatures.filename && signatures.filename.length > 0 && filePath) {
      filenameMatch = matchFilenameSignatures(filePath, signatures.filename)
    }

    // 文件头签名或文件名签名至少有一个匹配
    if (!headMatch && !filenameMatch) {
      // 如果两个都没定义，则认为匹配（只检查扩展名）
      if ((signatures.head && signatures.head.length > 0) || (signatures.filename && signatures.filename.length > 0)) {
        return false
      }
    }

    if (!headMatch && filenameMatch && signatures.filenameFallbackPatterns) {
      if (!filePath || !matchFilenameFallbackPatterns(filePath, signatures.filenameFallbackPatterns)) {
        return false
      }
    }

    // 4. 检查必需字段（如果定义了）
    if (signatures.requiredFields && signatures.requiredFields.length > 0) {
      if (!matchRequiredFields(headContent, signatures.requiredFields)) {
        return false
      }
    }

    // 5. 检查字段值模式（如果定义了）
    if (signatures.fieldPatterns) {
      for (const [, pattern] of Object.entries(signatures.fieldPatterns)) {
        if (!pattern.test(headContent)) {
          return false
        }
      }
    }

    return true
  }
}

/**
 * 创建并返回全局嗅探器实例
 */
export function createSniffer(): FormatSniffer {
  return new FormatSniffer()
}
