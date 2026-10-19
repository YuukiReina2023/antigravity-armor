import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDivertServer, resolveModelRoute } from '../src/layers/divert.mjs'
import { ensureLocalApiKey, generateApiKey, isValidApiKey, listApiKeys, maskApiKey, revokeApiKey } from '../src/local-api-key.mjs'
import { getConversationDetail, listConversations } from '../src/driver/session.mjs'

export function testLocalApiKeyIsGeneratedOnceAndReused() {
  const root = mkdtempSync(join(tmpdir(), 'aarmor-api-key-'))
  try {
    const cfg = { stateDir: join(root, 'state') }
    const key = ensureLocalApiKey(cfg)
    assert.match(key, /^sk-antigravity-[A-Za-z0-9_-]{43}$/)
    assert.equal(ensureLocalApiKey(cfg), key)
    assert.equal(readFileSync(join(cfg.stateDir, 'local-api-key'), 'utf8').trim(), key)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function testManagedApiKeysSupportLabelsAndRevocation() {
  const root = mkdtempSync(join(tmpdir(), 'aarmor-managed-api-keys-'))
  try {
    const cfg = { stateDir: join(root, 'state') }
    const first = generateApiKey(cfg, 'Claude Desktop')
    const second = generateApiKey(cfg, 'Open WebUI')
    assert.match(first.key, /^sk-antigravity-[A-Za-z0-9_-]{32}$/)
    assert.equal(first.name, 'Claude Desktop')
    assert.equal(maskApiKey(first.key), first.key.slice(0, 6) + '…' + first.key.slice(-4))
    assert.equal(isValidApiKey(cfg, first.key), true)
    assert.equal(isValidApiKey(cfg, second.key), true)
    assert.equal(revokeApiKey(cfg, first.id), true)
    assert.equal(isValidApiKey(cfg, first.key), false)
    assert.equal(isValidApiKey(cfg, second.key), true)
    assert.equal(listApiKeys(cfg).find((item) => item.id === first.id).status, 'revoked')
    assert.equal(revokeApiKey(cfg, 'does-not-exist'), false)
    const defaultKey = ensureLocalApiKey(cfg)
    assert.equal(revokeApiKey(cfg, 'default'), true)
    assert.equal(isValidApiKey(cfg, defaultKey, defaultKey), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export async function testLocalApiKeyProtectsCompatibilityEndpoints() {
  const root = mkdtempSync(join(tmpdir(), 'aarmor-api-auth-'))
  const cfg = {
    stateDir: join(root, 'state'),
    logDir: join(root, 'logs'),
    divert: { port: 0, passThrough: true, sameModel: false, model: 'gemini-3.8-flash', modelMapping: {} },
  }
  const apiKey = generateApiKey(cfg, 'test client').key
  const { server } = createDivertServer(cfg, { key: 'test', localApiKey: ensureLocalApiKey(cfg) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  try {
    const missingKey = await fetch(base + '/v1/models')
    assert.equal(missingKey.status, 401)
    assert.equal((await missingKey.json()).error.type, 'authentication_error')

    const bearerResponse = await fetch(base + '/v1/models', {
      headers: { Authorization: 'Bearer ' + apiKey },
    })
    assert.equal(bearerResponse.status, 200)

    const anthropicResponse = await fetch(base + '/v1/models', {
      headers: { 'x-api-key': apiKey },
    })
    assert.equal(anthropicResponse.status, 200)

    assert.equal(revokeApiKey(cfg, listApiKeys(cfg).find((item) => item.key === apiKey).id), true)
    const revokedResponse = await fetch(base + '/v1/models', {
      headers: { Authorization: 'Bearer ' + apiKey },
    })
    assert.equal(revokedResponse.status, 401)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
}

export async function testConversationHistoryReadsOrderedMessagesAndMetadata() {
  const root = mkdtempSync(join(tmpdir(), 'aarmor-conversation-history-'))
  const conversationRoot = join(root, 'conversations')
  mkdirSync(conversationRoot, { recursive: true })
  const id = '00000000-0000-4000-8000-000000000001'
  const db = new DatabaseSync(join(conversationRoot, id + '.db'))
  db.exec('CREATE TABLE steps (idx INTEGER, status INTEGER, step_type INTEGER, step_payload BLOB)')
  const insert = db.prepare('INSERT INTO steps VALUES (?, ?, ?, ?)')
  insert.run(1, 3, 14, Buffer.from('How do I summarize this file?'))
  insert.run(2, 3, 15, assistantPayload('```js\nconst answer = 42\n```'))
  db.close()

  try {
    const cfg = { paths: { convRoots: [conversationRoot] }, geminiHome: root }
    const list = listConversations(cfg, 10)
    assert.equal(list.length, 1)
    assert.equal(list[0].id, id)
    assert.ok(list[0].createdAt)
    assert.ok(list[0].updatedAt)

    const detail = await getConversationDetail(cfg, id)
    assert.equal(detail.turns, 1)
    assert.deepEqual(detail.messages.map((message) => message.role), ['user', 'assistant'])
    assert.match(detail.messages[0].text, /How do I summarize this file/)
    assert.match(detail.messages[1].text, /```js/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export async function testClaudeAliasReportsAgyCliFailure() {
  const cfg = {
    logDir: 'state/logs',
    divert: {
      port: 0,
      passThrough: true,
      sameModel: false,
      model: 'gemini-3.8-flash',
      modelMapping: {
        'claude-sonnet-5-5': { backend: 'antigravity', googleModel: 'gemini-3.8-flash-high' },
      },
    },
  }
  const { server } = createDivertServer(cfg, {
    key: 'test',
    findRunningLs: async () => ({ httpPort: 49459, csrf: 'test-csrf' }),
    runAgyPrompt: async () => ({ stdout: '', stderr: 'AGY failed', code: 1, failed: true }),
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'test' }],
      }),
    })
    const body = await response.json()
    assert.equal(response.status, 502)
    assert.match(body.error.message, /AGY CLI failed/)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

export function testConfiguredClaudeAliasesOnlySelectGoogleThreeModels() {
  const configUrl = new URL('../armor.config.json', import.meta.url)
  const config = JSON.parse(readFileSync(configUrl, 'utf8'))
  const mappings = Object.entries(config.divert.modelMapping)
  assert.ok(mappings.some(([alias]) => alias === 'claude-fable-5-1'))
  assert.ok(mappings.some(([alias]) => alias === 'claude-opus-5-5'))
  assert.ok(mappings.some(([alias]) => alias === 'claude-sonnet-5-5'))
  assert.ok(mappings.some(([alias]) => alias === 'claude-haiku-5-5'))
  assert.ok(mappings.some(([alias]) => alias === 'claude-mythos-5-1'))
  assert.equal(config.divert.modelMapping['claude-haiku-5-5'].googleModel, 'gemini-3.8-flash')
  assert.equal(config.divert.modelMapping['claude-sonnet-5-5'].googleModel, 'gemini-3.8-flash-high')
  assert.equal(config.divert.modelMapping['claude-opus-5-5'].googleModel, 'gemini-3.1-pro')
  assert.equal(config.divert.modelMapping['claude-fable-5-1'].googleModel, 'gemini-3.1-pro-high')
  assert.equal(config.divert.modelMapping['claude-mythos-5-1'].googleModel, 'gemini-3.1-pro-high')
  const levels = [
    ['claude-haiku-5-5', 'gemini-3.8-flash', 'flash'],
    ['claude-sonnet-5-5', 'gemini-3.8-flash-high', 'flash'],
    ['claude-opus-5-5', 'gemini-3.1-pro', 'pro'],
    ['claude-fable-5-1', 'gemini-3.1-pro-high', 'pro'],
    ['claude-mythos-5-1', 'gemini-3.1-pro-high', 'pro'],
  ]
  for (const [alias, googleModel, tier] of levels) {
    const route = resolveModelRoute(config, alias)
    assert.equal(route.googleModel, googleModel)
    assert.equal(route.tier, tier)
  }
  for (const [, route] of mappings) {
    assert.equal(route.backend, 'antigravity')
    assert.match(route.googleModel, /^gemini-3\./)
    assert.equal(route.target, undefined)
    assert.equal(route.keyRef, undefined)
  }
}

function assistantPayload(text) {
  const id = Buffer.from('bot-' + 'x'.repeat(32))
  const content = Buffer.from(text)
  return Buffer.concat([id, Buffer.from([0x42, content.length]), content])
}

export async function testClaudeAliasesUseLocalGoogleBackendForBothProtocols() {
  const root = mkdtempSync(join(tmpdir(), 'aarmor-claude-alias-'))
  const cfg = {
    logDir: join(root, 'logs'),
    divert: {
      port: 0,
      upstream: 'http://127.0.0.1:59999',
      target: 'http://127.0.0.1:59999/v1/chat/completions',
      passThrough: true,
      sameModel: false,
      model: 'gemini-3.8-flash',
      claude: { model: 'claude-sonnet-5-5', googleModel: 'gemini-3.8-flash-high' },
      modelMapping: {
        'claude-opus-5-5': { backend: 'antigravity', googleModel: 'gemini-3.1-pro', family: 'Opus' },
        'claude-sonnet-5-5': { backend: 'antigravity', googleModel: 'gemini-3.8-flash-high', family: 'Sonnet' },
      },
    },
  }
  const created = []
  const { server } = createDivertServer(cfg, {
    key: 'test',
    findRunningLs: async () => { throw new Error('API requests must not inspect the desktop Language Server') },
    newConversation: () => { throw new Error('API requests must not create desktop conversations') },
    runAgyPrompt: async (_cfg, options) => {
      created.push({ prompt: options.prompt, model: options.model, direct: options.direct })
      return { stdout: 'Google-backed local reply\n', stderr: '', code: 0 }
    },
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  try {
    const modelsResponse = await fetch(base + '/v1/models', { headers: { Authorization: 'Bearer local-api-key-for-tests' } })
    const models = await modelsResponse.json()
    const listed = new Map(models.data.map((model) => [model.id, model]))
    assert.deepEqual([...listed.keys()], [
      'gemini-3.8-flash',
      'gemini-3.8-flash-high',
      'gemini-3.1-pro',
      'gemini-3.1-pro-high',
    ])
    assert.ok(models.data.every((entry) => entry.owned_by === 'google'))

    const claudeModelsResponse = await fetch(base + '/v1/models', {
      headers: { 'x-api-key': 'test-anthropic-key' },
    })
    const claudeModels = await claudeModelsResponse.json()
    const claudeListed = new Map(claudeModels.data.map((entry) => [entry.id, entry]))
    assert.deepEqual([...claudeListed.keys()], [
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-opus-5-5',
      'claude-fable-5-1',
      'claude-mythos-5-1',
    ])
    assert.equal(claudeListed.get('claude-opus-5-5').root, 'gemini-3.1-pro')
    assert.equal(claudeListed.get('claude-sonnet-5-5').root, 'gemini-3.8-flash-high')
    assert.equal(claudeListed.get('claude-fable-5-1').root, 'gemini-3.1-pro-high')
    assert.equal(claudeListed.get('claude-mythos-5-1').root, 'gemini-3.1-pro-high')

    const nativeResponse = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'local-api-key-for-tests' },
      body: JSON.stringify({
        model: 'claude-opus-5-5',
        max_tokens: 200,
        messages: [{ role: 'user', content: 'Native request' }],
      }),
    })
    const nativeBody = await nativeResponse.json()
    assert.equal(nativeResponse.status, 200)
    assert.equal(nativeBody.model, 'claude-opus-5-5')
    assert.equal(nativeBody.content[0].text, 'Google-backed local reply')

    const openAiResponse = await fetch(base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ignored-client-key' },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        messages: [{ role: 'user', content: 'OpenAI-compatible request' }],
      }),
    })
    const openAiBody = await openAiResponse.json()
    assert.equal(openAiResponse.status, 200)
    assert.equal(openAiBody.model, 'claude-sonnet-5-5')
    assert.equal(openAiBody.choices[0].message.content, 'Google-backed local reply')
    assert.deepEqual(created.map((row) => row.model), ['gemini-3.1-pro', 'gemini-3.8-flash-high'])
    assert.deepEqual(created.map((row) => row.direct), [true, true])
    assert.match(created[0].prompt, /Native request/)
    assert.match(created[1].prompt, /OpenAI-compatible request/)

    const anthropicStream = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'local-api-key-for-tests' },
      body: JSON.stringify({
        model: 'claude-opus-5-5',
        max_tokens: 200,
        stream: true,
        messages: [{ role: 'user', content: 'Streaming Claude request' }],
      }),
    })
    const anthropicEvents = await anthropicStream.text()
    assert.equal(anthropicStream.status, 200)
    assert.match(anthropicEvents, /event: message_start/)
    assert.match(anthropicEvents, /Google-backed local reply/)
    assert.match(anthropicEvents, /event: message_stop/)

    const openAiStream = await fetch(base + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: '******' },
      body: JSON.stringify({
        model: 'gemini-3.8-flash',
        stream: true,
        messages: [{ role: 'user', content: 'Streaming OpenAI request' }],
      }),
    })
    const openAiEvents = await openAiStream.text()
    assert.equal(openAiStream.status, 200)
    assert.match(openAiEvents, /chat\.completion\.chunk/)
    assert.match(openAiEvents, /Google-backed local reply/)
    assert.match(openAiEvents, /data: \[DONE\]/)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
}

export async function testClaudeAliasDoesNotFallBackToConfiguredExternalTarget() {
  const cfg = {
    logDir: 'state/logs',
    divert: {
      port: 0,
      upstream: 'http://127.0.0.1:59999',
      target: 'http://127.0.0.1:59999/v1/chat/completions',
      passThrough: true,
      sameModel: false,
      claude: { googleModel: 'gemini-3.8-flash' },
      modelMapping: {
        'claude-haiku-5-5': {
          backend: 'antigravity',
          googleModel: 'gemini-3.8-flash',
          target: 'http://127.0.0.1:59999/v1/messages',
          keyRef: 'SHOULD_NOT_BE_USED',
        },
      },
    },
  }
  const requestedModels = []
  const { server } = createDivertServer(cfg, {
    key: 'test',
    findRunningLs: async () => { throw new Error('API requests must not inspect the desktop Language Server') },
    runAgyPrompt: async (_cfg, options) => {
      requestedModels.push(options.model)
      return { stdout: 'AGY local response', stderr: '', code: 0 }
    },
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'not-an-anthropic-key' },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'Local-only check' }],
      }),
    })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.content[0].text, 'AGY local response')

    const openAiResponse = await fetch(`http://127.0.0.1:${server.address().port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-an-api-key' },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        messages: [{ role: 'user', content: 'Local-only OpenAI check' }],
      }),
    })
    const openAiBody = await openAiResponse.json()
    assert.equal(openAiResponse.status, 200)
    assert.equal(openAiBody.choices[0].message.content, 'AGY local response')
    assert.deepEqual(requestedModels, ['gemini-3.8-flash', 'gemini-3.8-flash'])
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
