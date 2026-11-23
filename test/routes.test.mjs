import assert from 'node:assert/strict'
import test from 'node:test'

import { createRoutes } from '../lib/routes.js'

const SETTINGS = { comfyUrl: 'http://127.0.0.1:8188', comfyRoot: '', values: {} }

/** A settings stub that records every read, so a test can prove a rejected request never touched it. */
function stubSettings() {
  let reads = 0
  return {
    settings: {
      read() {
        reads += 1
        return SETTINGS
      },
    },
    get reads() {
      return reads
    },
  }
}

function makeRes() {
  const res = {
    status: null,
    headers: null,
    body: '',
    writableEnded: false,
    destroyed: false,
    writeHead(status, headers) {
      res.status = status
      res.headers = headers
    },
    end(body) {
      res.body = body === undefined ? '' : String(body)
      res.writableEnded = true
    },
  }
  return res
}

function makeReq({ method = 'GET', url = '/krea2/settings', headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  // No `.on`: a handler that tried to read the body would throw here, which
  // is exactly what proves a rejected mutation never reads its body.
  return { method, url, headers, socket: { remoteAddress } }
}

function json(res) {
  return JSON.parse(res.body)
}

function routesWith({ connection, settingsStub } = {}) {
  const stub = settingsStub ?? stubSettings()
  const handle = createRoutes({
    settings: stub.settings,
    jobs: {},
    workflows: {},
    objectInfo: {},
    presets: {},
    getConnection: connection === undefined ? undefined : () => connection,
  })
  return { handle, stub }
}

const SAME_ORIGIN = {
  host: '127.0.0.1:3000',
  origin: 'http://127.0.0.1:3000',
  'sec-fetch-site': 'same-origin',
}

test('admits a same-origin request when the connection service admits it', async () => {
  const { handle, stub } = routesWith({ connection: { requestRejection: () => undefined } })
  const req = makeReq({ headers: SAME_ORIGIN })
  const res = makeRes()

  await handle(req, res)

  assert.equal(res.status, 200)
  assert.equal(json(res).ok, true)
  assert.deepEqual(json(res).settings, SETTINGS)
  assert.equal(stub.reads, 1)
})

test('rejects with 401 when the connection service says unauthenticated', async () => {
  const { handle, stub } = routesWith({ connection: { requestRejection: () => 401 } })
  const req = makeReq({ headers: SAME_ORIGIN })
  const res = makeRes()

  await handle(req, res)

  assert.equal(res.status, 401)
  assert.equal(json(res).error.code, 'UNAUTHENTICATED')
  assert.equal(stub.reads, 0)
})

test('rejects with 403 when the connection service says untrusted', async () => {
  const { handle, stub } = routesWith({ connection: { requestRejection: () => 403 } })
  const req = makeReq({ headers: SAME_ORIGIN })
  const res = makeRes()

  await handle(req, res)

  assert.equal(res.status, 403)
  assert.equal(json(res).error.code, 'FORBIDDEN')
  assert.equal(stub.reads, 0)
})

test('rejects before the route runs, not with the route error', async () => {
  const { handle, stub } = routesWith({ connection: { requestRejection: () => 401 } })
  const req = makeReq({ url: '/krea2/nope', headers: SAME_ORIGIN })
  const res = makeRes()

  await handle(req, res)

  assert.equal(res.status, 401)
  assert.equal(stub.reads, 0)
})

test('rejects a mutation before its body is read', async () => {
  const { handle, stub } = routesWith({ connection: { requestRejection: () => 401 } })
  // The request carries no `.on`, so reading the body would throw.
  const req = makeReq({
    method: 'POST',
    url: '/krea2/generate',
    headers: { ...SAME_ORIGIN, 'content-type': 'application/json' },
  })
  const res = makeRes()

  await handle(req, res)

  assert.equal(res.status, 401)
  assert.equal(stub.reads, 0)
})

test('fails closed when requestRejection throws', async () => {
  const { handle, stub } = routesWith({
    connection: {
      requestRejection: () => {
        throw new Error('connection half-initialized')
      },
    },
  })
  const req = makeReq({ headers: SAME_ORIGIN })
  const res = makeRes()

  await handle(req, res)

  assert.equal(res.status, 403)
  assert.equal(stub.reads, 0)
})

test('admits a same-origin loopback request without the connection service', async () => {
  const { handle, stub } = routesWith({ connection: undefined })
  const req = makeReq({ headers: SAME_ORIGIN })
  const res = makeRes()

  await handle(req, res)

  assert.equal(res.status, 200)
  assert.equal(stub.reads, 1)
})

test('admits a loopback request with no Origin, as the Desktop shell sends', async () => {
  const { handle, stub } = routesWith({ connection: undefined })
  const req = makeReq({
    headers: { host: 'localhost:3000' },
    remoteAddress: '::1',
  })
  const res = makeRes()

  await handle(req, res)

  assert.equal(res.status, 200)
  assert.equal(stub.reads, 1)
})

test('rejects a cross-site page without the connection service', async () => {
  const { handle, stub } = routesWith({ connection: undefined })
  const req = makeReq({
    headers: {
      host: '127.0.0.1:3000',
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    },
  })
  const res = makeRes()

  await handle(req, res)

  assert.equal(res.status, 403)
  assert.equal(json(res).error.code, 'CROSS_ORIGIN')
  assert.equal(stub.reads, 0)
})

test('rejects a non-loopback peer without the connection service', async () => {
  const { handle, stub } = routesWith({ connection: undefined })
  const req = makeReq({ headers: SAME_ORIGIN, remoteAddress: '192.168.1.5' })
  const res = makeRes()

  await handle(req, res)

  assert.equal(res.status, 403)
  assert.equal(stub.reads, 0)
})

test('rejects a rebinding Host without the connection service', async () => {
  const { handle, stub } = routesWith({ connection: undefined })
  // Host and Origin agree on the attacker's domain, so only the loopback
  // Host check can catch this: the browser connected to 127.0.0.1 while
  // the page claims to be evil.example.
  const req = makeReq({ headers: { host: 'evil.example' } })
  const res = makeRes()

  await handle(req, res)

  assert.equal(res.status, 403)
  assert.equal(stub.reads, 0)
})
