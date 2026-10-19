import assert from 'node:assert/strict'
import http from 'node:http'
import {
  resolveModelRoute,
  createDivertServer,
  CLAUDE_MODELS,
  AUTHENTIC_MODELS
} from '../src/layers/divert.mjs'

export function testResolveModelRouteExact() {
  const cfg = {
    divert: {
      modelMapping: {
        'claude-3-7-sonnet': {
          backend: 'antigravity',
          googleModel: 'gemini-3.1-pro'
        }
      }
    }
  }
  const r = resolveModelRoute(cfg, 'claude-3-7-sonnet')
  assert.ok(r)
  assert.equal(r.backend, 'antigravity')
  assert.equal(r.googleModel, 'gemini-3.1-pro')
  assert.equal(r.target, null)
  assert.equal(r.keyRef, null)
  assert.equal(r.protocol, 'anthropic')
  assert.equal(r.isClaude, true)
}

export function testResolveModelRouteCaseInsensitiveAndPrefix() {
  const cfg = {
    divert: {
      claude: {
        googleModel: 'gemini-3.8-flash',
        model: 'claude-sonnet-5-5'
      }
    }
  }
  const r1 = resolveModelRoute(cfg, 'Claude-3-5-Haiku-Latest')
  assert.ok(r1)
  assert.equal(r1.isClaude, true)
  assert.equal(r1.target, null)
  assert.equal(r1.googleModel, 'gemini-3.8-flash')

  const rLatest = resolveModelRoute(cfg, 'claude-opus-5-5')
  assert.ok(rLatest)
  assert.equal(rLatest.backend, 'antigravity')
  assert.equal(rLatest.googleModel, 'gemini-3.8-flash')

  const r2 = resolveModelRoute(cfg, 'gemini-3.8-flash')
  assert.equal(r2, null)
}

export async function testLoginEndpointRelayUsesConfiguredTransport() {
  let receivedAuthorization = null
  let receivedPath = null
  const upstreamServer = http.createServer((req, res) => {
    receivedAuthorization = req.headers.authorization
    receivedPath = req.url
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ authenticated: true }))
  })
  await new Promise((resolve) => upstreamServer.listen(0, '127.0.0.1', resolve))
  const upstreamUrl = `http://127.0.0.1:${upstreamServer.address().port}`
  const cfg = {
    logDir: 'state/logs',
    divert: {
      port: 0,
      upstream: upstreamUrl,
      target: upstreamUrl,
      model: 'test-model',
      passThrough: true,
      sameModel: false,
      keyRef: 'TEST_KEY'
    }
  }
  const { server } = createDivertServer(cfg, { key: 'test' })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const authToken = ['login', 'test', 'token'].join('-')
    const authorization = 'Bearer ' + authToken
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization
      },
      body: JSON.stringify({ client: 'antigravity' })
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { authenticated: true })
    assert.equal(receivedAuthorization, authorization)
    assert.equal(receivedPath, '/v1internal:loadCodeAssist')
  } finally {
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstreamServer.close(resolve))
    ])
  }
}
