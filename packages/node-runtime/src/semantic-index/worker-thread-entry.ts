import { parentPort, workerData } from 'node:worker_threads'
import type { SemanticIndexWorkerStartupOptions } from './worker-runtime'

const startup = workerData as SemanticIndexWorkerStartupOptions

async function main(): Promise<void> {
  const { createSemanticIndexWorkerRuntime, createSemanticIndexWorkerServiceFactory } =
    (await import('./worker-runtime.js')) as typeof import('./worker-runtime')
  const runtime = createSemanticIndexWorkerRuntime({
    serviceFactory: createSemanticIndexWorkerServiceFactory(startup),
  })

  parentPort?.on('message', async (message) => {
    const payload = message as { id: string; method: string; args?: unknown[] }
    try {
      const result = await runtime.handleRequest(payload.method, payload.args ?? [])
      parentPort?.postMessage({ id: payload.id, success: true, result })
    } catch (error) {
      parentPort?.postMessage({
        id: payload.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

void main().catch((error) => {
  console.error('[semantic-index] worker failed to start:', error instanceof Error ? error.message : String(error))
  throw error
})
