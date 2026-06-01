/**
 * ElectronDataAdapter — Electron 专用 DataAdapter
 *
 * 普通数据查询继续复用共享 HTTP 路由；计算密集型 pluginCompute
 * 通过 Electron worker 执行，避免在 renderer 主线程同步阻塞图表交互。
 */

import { FetchDataAdapter } from './fetch'

export class ElectronDataAdapter extends FetchDataAdapter {
  async pluginCompute<T = unknown>(fnString: string, input: unknown): Promise<T> {
    return window.chatApi.pluginCompute<T>(fnString, input)
  }
}
