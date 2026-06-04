'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { launchApp, __test__ } = require('./app-launcher')

function createFakeServerFactory(plan) {
  let index = 0
  const state = {
    listenPorts: [],
    closeCount: 0,
  }

  function createServer() {
    const behavior = plan[index++] || { type: 'success' }
    const handlers = {}

    return {
      on(event, handler) {
        handlers[event] = handler
      },
      listen(port, callback) {
        state.listenPorts.push(port)
        setImmediate(() => {
          if (behavior.type === 'success') {
            callback()
            return
          }
          if (handlers.error) {
            handlers.error({ code: behavior.code || 'EADDRINUSE' })
          }
        })
      },
      close() {
        state.closeCount += 1
      },
    }
  }

  return { createServer, state }
}

test('findAvailablePortWithReservation 会重试并返回可用端口', async () => {
  const { createServer, state } = createFakeServerFactory([{ type: 'error', code: 'EADDRINUSE' }, { type: 'success' }])

  const reservation = await __test__.findAvailablePortWithReservation(9222, 5, 0, {
    createServer,
    listenTimeoutMs: 20,
  })

  assert.equal(reservation.port, 9223)
  assert.deepEqual(state.listenPorts, [9222, 9223])

  __test__.releaseReservation(reservation.reservationServer)
  assert.equal(state.closeCount, 2)
})

test('findAvailablePortWithReservation 达到最大重试会抛错', async () => {
  const { createServer } = createFakeServerFactory([
    { type: 'error', code: 'EADDRINUSE' },
    { type: 'error', code: 'EADDRINUSE' },
  ])

  await assert.rejects(
    () =>
      __test__.findAvailablePortWithReservation(9300, 2, 0, {
        createServer,
        listenTimeoutMs: 20,
      }),
    /Unable to find available port/
  )
})

test('launchApp 支持 startPort 并正确注入 TEST_MODE 环境', async () => {
  const fakeElectronPath = '/tmp/fake-electron'
  const captured = {
    startPort: null,
    spawnCmd: null,
    spawnArgs: null,
    spawnEnv: null,
    reservationClosed: false,
    killSignals: [],
  }

  const proc = new EventEmitter()
  proc.pid = 34567
  proc.exitCode = null
  proc.signalCode = null
  proc.kill = (signal) => {
    captured.killSignals.push(signal)
    if (signal === 'SIGTERM') {
      proc.exitCode = 0
      proc.emit('exit', 0, null)
    }
    return true
  }

  const app = await launchApp(
    {
      startPort: 9900,
      startupWaitTime: 1,
      forceKillTimeoutMs: 100,
    },
    {
      fsImpl: {
        existsSync: () => true,
        mkdirSync: () => {},
      },
      sleepFn: async () => {},
      electronPath: fakeElectronPath,
      findPortFn: async (startPort) => {
        captured.startPort = startPort
        return {
          port: 9901,
          reservationServer: {
            close: () => {
              captured.reservationClosed = true
            },
          },
        }
      },
      spawnFn: (cmd, args, options) => {
        captured.spawnCmd = cmd
        captured.spawnArgs = args
        captured.spawnEnv = options.env
        return proc
      },
    }
  )

  assert.equal(captured.startPort, 9900)
  assert.equal(captured.reservationClosed, true)
  assert.equal(captured.spawnCmd, fakeElectronPath)
  assert.deepEqual(captured.spawnArgs, ['--remote-debugging-port=9901', captured.spawnArgs[1]])
  assert.equal(captured.spawnEnv.TEST_MODE, 'true')
  assert.match(captured.spawnEnv.CHATLAB_E2E_USER_DATA_DIR, /chatlab-e2e-9901$/)

  await app.close()
  assert.deepEqual(captured.killSignals, ['SIGTERM'])
})

test('launchApp 允许注入额外环境变量覆盖', async () => {
  const captured = {
    spawnEnv: null,
  }

  const proc = new EventEmitter()
  proc.pid = 45678
  proc.exitCode = null
  proc.signalCode = null
  proc.kill = () => {
    proc.exitCode = 0
    proc.emit('exit', 0, null)
    return true
  }

  const app = await launchApp(
    {
      startupWaitTime: 1,
      envOverrides: {
        CHATLAB_DATA_DIR: 'C:\\temp\\chat-data',
        USERPROFILE: 'C:\\temp\\profile',
      },
    },
    {
      fsImpl: {
        existsSync: () => true,
        mkdirSync: () => {},
      },
      sleepFn: async () => {},
      findPortFn: async () => ({
        port: 9910,
        reservationServer: { close: () => {} },
      }),
      spawnFn: (_cmd, _args, options) => {
        captured.spawnEnv = options.env
        return proc
      },
    }
  )

  assert.equal(captured.spawnEnv.CHATLAB_DATA_DIR, 'C:\\temp\\chat-data')
  assert.equal(captured.spawnEnv.USERPROFILE, 'C:\\temp\\profile')

  await app.close()
})
