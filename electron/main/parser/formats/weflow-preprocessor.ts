/**
 * WeFlow 格式预处理器
 * 用于大文件预处理，移除冗余字段
 *
 * 当前为预留实现，WeFlow 格式的字段结构较为简洁，
 * 暂不需要复杂的预处理逻辑。
 *
 * 如果未来发现性能问题，可在此添加：
 * - 移除 formattedTime 字段（可由 createTime 计算）
 * - 移除 source 字段（通常为空）
 * - 移除 localType 字段（不可信）
 */

import type { Preprocessor, ParseProgress } from '../types'

/**
 * WeFlow 预处理器
 * 当前为预留实现，返回不需要预处理
 */
export const weflowPreprocessor: Preprocessor = {
  /**
   * 判断是否需要预处理
   * 当前策略：暂不需要预处理
   * 如果未来发现大文件性能问题，可调整阈值
   */
  needsPreprocess(_filePath: string, _fileSize: number): boolean {
    // 预留：如果文件超过 100MB 可能需要预处理
    // const THRESHOLD = 100 * 1024 * 1024 // 100MB
    // return fileSize > THRESHOLD
    return false
  },

  /**
   * 执行预处理
   * 当前为预留实现，直接返回原文件路径
   */
  async preprocess(filePath: string, _onProgress?: (progress: ParseProgress) => void): Promise<string> {
    // 预留：未来可在此实现精简逻辑
    // 1. 使用流式读取原文件
    // 2. 移除冗余字段 (formattedTime, source, localType)
    // 3. 写入临时文件
    // 4. 返回临时文件路径
    return filePath
  },

  /**
   * 清理临时文件
   */
  cleanup(_tempPath: string): void {
    // 预留：当 preprocess 返回临时文件时，在此清理
    // if (tempPath !== originalFilePath) {
    //   fs.unlinkSync(tempPath)
    // }
  },
}

export default weflowPreprocessor
