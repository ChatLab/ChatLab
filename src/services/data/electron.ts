/**
 * ElectronDataAdapter — Electron 专用 DataAdapter
 *
 * 普通数据查询继续复用共享 HTTP 路由。
 * pluginCompute 使用 FetchDataAdapter 的 renderer-local 实现，避免通过 IPC 执行函数字符串。
 */

import { FetchDataAdapter } from './fetch'

export class ElectronDataAdapter extends FetchDataAdapter {}
