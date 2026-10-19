import assert from 'node:assert/strict'
import http from 'node:http'
import {
  resolveModelRoute,
  createDivertServer,
  CLAUDE_MODELS,
  AUTHENTIC_MODELS
} from '../src/layers/divert.mjs'
import { listClaudeModelMappings, setClaudeModelMapping } from '../src/model-mapping.mjs'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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

export function testClaudeModelMappingsCanBeListedAndPersisted() {
  const root = mkdtempSync(join(tmpdir(), 'aarmor-model-mapping-'))
  try {
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'armor.config.json'), JSON.stringify({
      divert: {
        modelMapping: {
          'claude-haiku-5-5': { backend: 'antigravity', googleModel: 'gemini-3.1-pro', family: 'Haiku' },
        },
      },
    }))
    const cfg = {
      projectRoot: root,
      divert: {
        modelMapping: {
          'claude-haiku-5-5': { backend: 'antigravity', googleModel: 'gemini-3.1-pro', family: 'Haiku' },
        },
      },
    }
    assert.equal(listClaudeModelMappings(cfg)[0].googleModel, 'gemini-3.1-pro')

    const updated = setClaudeModelMapping(cfg, 'claude-haiku-5-5', 'gemini-3.8-flash-high')
    assert.equal(updated.googleModel, 'gemini-3.8-flash-high')
    const saved = JSON.parse(readFileSync(join(root, 'armor.config.json'), 'utf8'))
    assert.equal(saved.divert.modelMapping['claude-haiku-5-5'].googleModel, 'gemini-3.8-flash-high')
    assert.equal(resolveModelRoute({
      divert: saved.divert,
    }, 'claude-haiku-5-5').googleModel, 'gemini-3.8-flash-high')
    assert.throws(() => setClaudeModelMapping(cfg, 'claude-unknown', 'gemini-3.8-flash'), /Unsupported Claude model alias/)
    assert.throws(() => setClaudeModelMapping(cfg, 'claude-haiku-5-5', 'gpt-4o'), /Unsupported Google model/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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
