import type { RpcWorkerRequestEnvelope } from '../rpc/protocol'
import { WebRuntimeWorkerController } from './controller'

interface DedicatedWorkerScope {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: MessageEvent<RpcWorkerRequestEnvelope>) => void): void
}

const workerScope = globalThis as unknown as DedicatedWorkerScope
const controller = new WebRuntimeWorkerController({
  postMessage(message) {
    workerScope.postMessage(message)
  },
})

workerScope.addEventListener('message', (event) => {
  controller.handleMessage(event.data)
})
