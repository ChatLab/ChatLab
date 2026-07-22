import { detectBrowserCapabilities } from '../capabilities'
import type {
  RpcRequestEnvelope,
  RpcResponseEnvelope,
  RuntimeLogEvent,
  SerializedRpcError,
  BrowserCapabilityReport,
  OpenDatabaseResult,
  WebRuntimeTaskResult,
  WebRuntimeTaskType,
} from '../rpc/protocol'
import { isRpcWorkerRequestEnvelope } from '../rpc/protocol'
import { WebRuntimeError } from '../runtime-error'
import { BrowserDatabaseRuntime, type DatabaseOpenStage } from '../sqlite/database-runtime'
import { BrowserSessionRuntime } from '../import/session-runtime'
import type { WorkspaceDatabasePort } from '../storage/workspace-database'

export interface WorkerMessageSink {
  postMessage(message: RpcResponseEnvelope): void
}

export interface WorkerDatabaseRuntime extends WorkspaceDatabasePort {
  open(filename: string, onStage?: (stage: DatabaseOpenStage) => void): Promise<OpenDatabaseResult>
  close(): Promise<{ closed: boolean }>
}

export type WorkerSessionRuntime = Pick<
  BrowserSessionRuntime,
  | 'detectFormat'
  | 'getSupportedFormats'
  | 'scanMultiChatSource'
  | 'importSource'
  | 'listSessions'
  | 'getSession'
  | 'deleteSession'
  | 'renameSession'
  | 'getHourlyActivity'
  | 'getDailyActivity'
  | 'getWeekdayActivity'
  | 'getTimeRange'
  | 'getAvailableYears'
  | 'getMemberActivity'
  | 'getMessageTypeDistribution'
  | 'getMessageLengthDistribution'
  | 'getTextStats'
  | 'getLongMessageCount'
  | 'getTextLengthPercentiles'
  | 'getMonthlyActivity'
  | 'getYearlyActivity'
  | 'getMemberMonthlyTrend'
  | 'getMembers'
  | 'getMentionAnalysis'
  | 'getMentionGraph'
  | 'getClusterGraph'
  | 'getRelationshipStats'
  | 'getJourneyStats'
  | 'getDuoProfileStats'
  | 'getLanguagePreferenceAnalysis'
  | 'getWordFrequency'
>

export class WebRuntimeWorkerController {
  private readonly cancelled = new Set<string>()
  private readonly pending = new Set<string>()
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly sink: WorkerMessageSink,
    private readonly databaseRuntime: WorkerDatabaseRuntime = new BrowserDatabaseRuntime(),
    private readonly capabilityDetector: () => BrowserCapabilityReport = detectBrowserCapabilities,
    private readonly sessionRuntime: WorkerSessionRuntime = new BrowserSessionRuntime(databaseRuntime)
  ) {}

  handleMessage(value: unknown): void {
    if (!isRpcWorkerRequestEnvelope(value)) return
    if (value.type === 'cancel') {
      if (this.pending.has(value.id)) this.cancelled.add(value.id)
      return
    }

    this.pending.add(value.id)
    this.queue = this.queue.then(() => this.execute(value))
  }

  private async execute(request: RpcRequestEnvelope): Promise<void> {
    try {
      this.throwIfCancelled(request.id)
      const result = await this.dispatch(request)
      this.sink.postMessage({
        id: request.id,
        type: 'result',
        payload: { taskType: request.type, result },
      })
    } catch (error) {
      const serialized = serializeRpcError(error)
      this.emitLog(request.id, {
        level: 'error',
        scope: 'web-runtime',
        message: 'Worker task failed',
        data: { taskType: request.type, code: serialized.code, error: serialized.message },
      })
      this.sink.postMessage({
        id: request.id,
        type: 'error',
        payload: { taskType: request.type, error: serialized },
      })
    } finally {
      this.pending.delete(request.id)
      this.cancelled.delete(request.id)
    }
  }

  private async dispatch(request: RpcRequestEnvelope): Promise<WebRuntimeTaskResult<WebRuntimeTaskType>> {
    switch (request.type) {
      case 'capabilities.check':
        return this.capabilityDetector()
      case 'db.open': {
        const capabilities = this.capabilityDetector()
        if (!capabilities.supported) {
          throw new WebRuntimeError(
            'UNSUPPORTED_BROWSER',
            `Required browser capabilities are unavailable: ${capabilities.missing.join(', ')}`
          )
        }
        this.emitProgress(request, 'capabilities-ready', 0.1)
        const result = await this.databaseRuntime.open(request.payload.filename, (stage) =>
          this.handleDatabaseStage(request, stage)
        )
        this.emitLog(request.id, {
          level: 'info',
          scope: 'web-runtime',
          message: 'Browser database opened and schema initialized',
          data: { sqliteVersion: result.sqliteVersion, schemaVersion: result.schemaVersion },
        })
        return result
      }
      case 'db.close': {
        const result = await this.databaseRuntime.close()
        if (result.closed) {
          this.emitLog(request.id, {
            level: 'info',
            scope: 'web-runtime',
            message: 'Browser database closed',
          })
        }
        return result
      }
      case 'import.formats':
        return this.sessionRuntime.getSupportedFormats()
      case 'import.detectFormat': {
        const formatId = await this.sessionRuntime.detectFormat(request.payload.source)
        return this.sessionRuntime.getSupportedFormats().find((format) => format.id === formatId) ?? null
      }
      case 'import.scanChats': {
        this.assertSupportedBrowser()
        this.emitLog(request.id, {
          level: 'info',
          scope: 'web-runtime',
          message: 'Browser multi-chat scan started',
          data: { size: request.payload.source.size },
        })
        const chats = await this.sessionRuntime.scanMultiChatSource(request.payload.source, {
          checkCancelled: () => this.throwIfCancelled(request.id),
        })
        this.emitLog(request.id, {
          level: 'info',
          scope: 'web-runtime',
          message: 'Browser multi-chat scan completed',
          data: { chatCount: chats.length },
        })
        return chats
      }
      case 'import.start': {
        this.assertSupportedBrowser()
        this.emitLog(request.id, {
          level: 'info',
          scope: 'web-runtime',
          message: 'Browser import started',
          data: {
            size: request.payload.source.size,
            requestedFormat: request.payload.formatId ?? 'auto',
            chatIndex: request.payload.chatIndex,
          },
        })
        const result = await this.sessionRuntime.importSource(request.payload.source, {
          formatId: request.payload.formatId,
          chatIndex: request.payload.chatIndex,
          checkCancelled: () => this.throwIfCancelled(request.id),
          onProgress: (progress) =>
            this.emitProgress(request, progress.stage, progress.progress, progress.messagesProcessed),
          onLog: (event) =>
            this.emitLog(request.id, {
              ...event,
              scope: 'web-runtime',
            }),
        })
        this.emitLog(request.id, {
          level: 'info',
          scope: 'web-runtime',
          message: 'Browser import completed',
          data: {
            sessionId: result.sessionId,
            formatId: result.formatId,
            messageCount: result.messageCount,
            memberCount: result.memberCount,
          },
        })
        return result
      }
      case 'session.list':
        this.assertSupportedBrowser()
        return this.sessionRuntime.listSessions((stage) => this.handleDatabaseStage(request, stage))
      case 'session.get':
        this.assertSupportedBrowser()
        return this.sessionRuntime.getSession(request.payload.sessionId)
      case 'session.delete':
        this.assertSupportedBrowser()
        return { deleted: await this.sessionRuntime.deleteSession(request.payload.sessionId) }
      case 'session.rename':
        this.assertSupportedBrowser()
        return { renamed: await this.sessionRuntime.renameSession(request.payload.sessionId, request.payload.name) }
      case 'analysis.hourly': {
        this.assertSupportedBrowser()
        const startedAt = performance.now()
        const result = await this.sessionRuntime.getHourlyActivity(request.payload.sessionId, request.payload.filter)
        this.emitLog(request.id, {
          level: 'debug',
          scope: 'web-runtime',
          message: 'Browser hourly activity query completed',
          data: { sessionId: request.payload.sessionId, durationMs: Math.round(performance.now() - startedAt) },
        })
        return result
      }
      case 'analysis.daily': {
        this.assertSupportedBrowser()
        const startedAt = performance.now()
        const result = await this.sessionRuntime.getDailyActivity(request.payload.sessionId, request.payload.filter)
        this.emitLog(request.id, {
          level: 'debug',
          scope: 'web-runtime',
          message: 'Browser daily activity query completed',
          data: { sessionId: request.payload.sessionId, durationMs: Math.round(performance.now() - startedAt) },
        })
        return result
      }
      case 'analysis.weekday': {
        this.assertSupportedBrowser()
        const startedAt = performance.now()
        const result = await this.sessionRuntime.getWeekdayActivity(request.payload.sessionId, request.payload.filter)
        this.emitLog(request.id, {
          level: 'debug',
          scope: 'web-runtime',
          message: 'Browser weekday activity query completed',
          data: { sessionId: request.payload.sessionId, durationMs: Math.round(performance.now() - startedAt) },
        })
        return result
      }
      case 'analysis.timeRange': {
        this.assertSupportedBrowser()
        const startedAt = performance.now()
        const result = await this.sessionRuntime.getTimeRange(request.payload.sessionId)
        this.emitLog(request.id, {
          level: 'debug',
          scope: 'web-runtime',
          message: 'Browser time range query completed',
          data: { sessionId: request.payload.sessionId, durationMs: Math.round(performance.now() - startedAt) },
        })
        return result
      }
      case 'analysis.availableYears': {
        this.assertSupportedBrowser()
        const startedAt = performance.now()
        const result = await this.sessionRuntime.getAvailableYears(request.payload.sessionId)
        this.emitLog(request.id, {
          level: 'debug',
          scope: 'web-runtime',
          message: 'Browser available years query completed',
          data: { sessionId: request.payload.sessionId, durationMs: Math.round(performance.now() - startedAt) },
        })
        return result
      }
      case 'analysis.members': {
        this.assertSupportedBrowser()
        const startedAt = performance.now()
        const result = await this.sessionRuntime.getMemberActivity(request.payload.sessionId, request.payload.filter)
        this.emitLog(request.id, {
          level: 'debug',
          scope: 'web-runtime',
          message: 'Browser member activity query completed',
          data: { sessionId: request.payload.sessionId, durationMs: Math.round(performance.now() - startedAt) },
        })
        return result
      }
      case 'analysis.messageTypes': {
        this.assertSupportedBrowser()
        const startedAt = performance.now()
        const result = await this.sessionRuntime.getMessageTypeDistribution(
          request.payload.sessionId,
          request.payload.filter
        )
        this.emitLog(request.id, {
          level: 'debug',
          scope: 'web-runtime',
          message: 'Browser message type distribution query completed',
          data: { sessionId: request.payload.sessionId, durationMs: Math.round(performance.now() - startedAt) },
        })
        return result
      }
      case 'analysis.messageLengths': {
        this.assertSupportedBrowser()
        const startedAt = performance.now()
        const result = await this.sessionRuntime.getMessageLengthDistribution(
          request.payload.sessionId,
          request.payload.filter
        )
        this.emitLog(request.id, {
          level: 'debug',
          scope: 'web-runtime',
          message: 'Browser message length distribution query completed',
          data: { sessionId: request.payload.sessionId, durationMs: Math.round(performance.now() - startedAt) },
        })
        return result
      }
      case 'analysis.textStats': {
        this.assertSupportedBrowser()
        const startedAt = performance.now()
        const result = await this.sessionRuntime.getTextStats(request.payload.sessionId, request.payload.filter)
        this.emitLog(request.id, {
          level: 'debug',
          scope: 'web-runtime',
          message: 'Browser text stats query completed',
          data: { sessionId: request.payload.sessionId, durationMs: Math.round(performance.now() - startedAt) },
        })
        return result
      }
      case 'analysis.longMessages': {
        this.assertSupportedBrowser()
        const startedAt = performance.now()
        const result = await this.sessionRuntime.getLongMessageCount(
          request.payload.sessionId,
          request.payload.filter,
          request.payload.minLength
        )
        this.emitLog(request.id, {
          level: 'debug',
          scope: 'web-runtime',
          message: 'Browser long message count query completed',
          data: {
            sessionId: request.payload.sessionId,
            minLength: request.payload.minLength,
            durationMs: Math.round(performance.now() - startedAt),
          },
        })
        return result
      }
      case 'analysis.textPercentiles': {
        this.assertSupportedBrowser()
        const startedAt = performance.now()
        const result = await this.sessionRuntime.getTextLengthPercentiles(
          request.payload.sessionId,
          request.payload.filter
        )
        this.emitLog(request.id, {
          level: 'debug',
          scope: 'web-runtime',
          message: 'Browser text length percentile query completed',
          data: { sessionId: request.payload.sessionId, durationMs: Math.round(performance.now() - startedAt) },
        })
        return result
      }
      case 'analysis.monthly': {
        const startedAt = this.startAnalysisQuery()
        const result = await this.sessionRuntime.getMonthlyActivity(request.payload.sessionId, request.payload.filter)
        this.emitAnalysisQueryCompleted(request, startedAt)
        return result
      }
      case 'analysis.yearly': {
        const startedAt = this.startAnalysisQuery()
        const result = await this.sessionRuntime.getYearlyActivity(request.payload.sessionId, request.payload.filter)
        this.emitAnalysisQueryCompleted(request, startedAt)
        return result
      }
      case 'analysis.memberMonthlyTrend': {
        const startedAt = this.startAnalysisQuery()
        const result = await this.sessionRuntime.getMemberMonthlyTrend(
          request.payload.sessionId,
          request.payload.filter
        )
        this.emitAnalysisQueryCompleted(request, startedAt)
        return result
      }
      case 'analysis.memberList': {
        const startedAt = this.startAnalysisQuery()
        const result = await this.sessionRuntime.getMembers(request.payload.sessionId)
        this.emitAnalysisQueryCompleted(request, startedAt)
        return result
      }
      case 'analysis.mentions': {
        const startedAt = this.startAnalysisQuery()
        const result = await this.sessionRuntime.getMentionAnalysis(request.payload.sessionId, request.payload.filter)
        this.emitAnalysisQueryCompleted(request, startedAt)
        return result
      }
      case 'analysis.mentionGraph': {
        const startedAt = this.startAnalysisQuery()
        const result = await this.sessionRuntime.getMentionGraph(request.payload.sessionId, request.payload.filter)
        this.emitAnalysisQueryCompleted(request, startedAt)
        return result
      }
      case 'analysis.clusterGraph': {
        const startedAt = this.startAnalysisQuery()
        const result = await this.sessionRuntime.getClusterGraph(
          request.payload.sessionId,
          request.payload.filter,
          request.payload.options
        )
        this.emitAnalysisQueryCompleted(request, startedAt)
        return result
      }
      case 'analysis.relationship': {
        const startedAt = this.startAnalysisQuery()
        const result = await this.sessionRuntime.getRelationshipStats(
          request.payload.sessionId,
          request.payload.filter,
          request.payload.options
        )
        this.emitAnalysisQueryCompleted(request, startedAt)
        return result
      }
      case 'analysis.journey': {
        const startedAt = this.startAnalysisQuery()
        const result = await this.sessionRuntime.getJourneyStats(request.payload.sessionId, request.payload.filter)
        this.emitAnalysisQueryCompleted(request, startedAt)
        return result
      }
      case 'analysis.duoProfile': {
        const startedAt = this.startAnalysisQuery()
        const result = await this.sessionRuntime.getDuoProfileStats(request.payload.sessionId, request.payload.filter)
        this.emitAnalysisQueryCompleted(request, startedAt)
        return result
      }
      case 'analysis.languagePreference': {
        const startedAt = this.startAnalysisQuery()
        const result = await this.sessionRuntime.getLanguagePreferenceAnalysis(
          request.payload.sessionId,
          request.payload.locale,
          request.payload.filter
        )
        this.emitAnalysisQueryCompleted(request, startedAt)
        return result
      }
      case 'analysis.wordFrequency': {
        const startedAt = this.startAnalysisQuery()
        const result = await this.sessionRuntime.getWordFrequency(request.payload.sessionId, request.payload.params)
        this.emitAnalysisQueryCompleted(request, startedAt)
        return result
      }
    }
  }

  private startAnalysisQuery(): number {
    this.assertSupportedBrowser()
    return performance.now()
  }

  private emitAnalysisQueryCompleted(request: RpcRequestEnvelope, startedAt: number): void {
    const payload = request.payload as { sessionId?: string } | undefined
    this.emitLog(request.id, {
      level: 'debug',
      scope: 'web-runtime',
      message: 'Browser insight query completed',
      data: {
        taskType: request.type,
        sessionId: payload?.sessionId,
        durationMs: Math.round(performance.now() - startedAt),
      },
    })
  }

  private handleDatabaseStage(request: RpcRequestEnvelope, stage: DatabaseOpenStage): void {
    this.throwIfCancelled(request.id)
    const progressByStage: Record<DatabaseOpenStage, number> = {
      'sqlite-initializing': 0.2,
      'sqlite-ready': 0.35,
      'opfs-pool-initializing': 0.45,
      'opfs-pool-ready': 0.6,
      'opfs-database-opening': 0.7,
      'opfs-database-opened': 0.8,
      'schema-initializing': 0.9,
      'schema-ready': 1,
    }
    this.emitProgress(request, stage, progressByStage[stage])
    if (
      stage === 'sqlite-ready' ||
      stage === 'opfs-pool-ready' ||
      stage === 'opfs-database-opened' ||
      stage === 'schema-ready'
    ) {
      this.emitLog(request.id, {
        level: 'info',
        scope: 'web-runtime',
        message: stage,
      })
    }
  }

  private emitProgress(request: RpcRequestEnvelope, stage: string, progress: number, messagesProcessed?: number): void {
    this.sink.postMessage({
      id: request.id,
      type: 'progress',
      payload: { taskType: request.type, stage, progress, messagesProcessed },
    })
  }

  private emitLog(id: string, event: RuntimeLogEvent): void {
    this.sink.postMessage({ id, type: 'log', payload: event })
  }

  private throwIfCancelled(id: string): void {
    if (this.cancelled.has(id)) throw new WebRuntimeError('REQUEST_CANCELLED', 'The Worker task was cancelled')
  }

  private assertSupportedBrowser(): void {
    const capabilities = this.capabilityDetector()
    if (!capabilities.supported) {
      throw new WebRuntimeError(
        'UNSUPPORTED_BROWSER',
        `Required browser capabilities are unavailable: ${capabilities.missing.join(', ')}`
      )
    }
  }
}

function serializeRpcError(error: unknown): SerializedRpcError {
  if (error instanceof WebRuntimeError) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack,
    }
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      code: 'WORKER_TASK_FAILED',
      message: error.message,
      stack: error.stack,
    }
  }
  return {
    name: 'Error',
    code: 'WORKER_TASK_FAILED',
    message: String(error),
  }
}
