import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function ensureLocalApiKey(cfg) {
  if (!cfg?.stateDir) throw new Error('stateDir is required to store the local API key')
  mkdirSync(cfg.stateDir, { recursive: true })
  const keyFile = join(cfg.stateDir, 'local-api-key')
  if (existsSync(keyFile)) {
    const key = readKey(keyFile)
    if (!key) throw new Error('Local API key file is empty: ' + keyFile)
    return key
  }

  const key = 'sk-antigravity-' + randomBytes(32).toString('base64url')
  try {
    writeFileSync(keyFile, key + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return key
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const existingKey = readKey(keyFile)
    if (!existingKey) throw new Error('Local API key file is empty: ' + keyFile)
    return existingKey
  }
}

function readKey(keyFile) {
  return readFileSync(keyFile, 'utf8').trim()
}

function keysJsonPath(cfg) {
  return join(cfg.stateDir, 'keys.json')
}

export function listApiKeys(cfg) {
  if (!cfg?.stateDir) throw new Error('stateDir is required to manage API keys')
  mkdirSync(cfg.stateDir, { recursive: true })
  const p = keysJsonPath(cfg)
  const defaultKey = ensureLocalApiKey(cfg)
  let items = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : []
  if (!Array.isArray(items) || items.some((item) =>
    !item || typeof item.id !== 'string' || typeof item.name !== 'string' ||
    typeof item.key !== 'string' || !['active', 'revoked'].includes(item.status)
  )) {
    throw new Error('Invalid API key registry: ' + p)
  }
  const defaultRecord = items.find((item) => item.id === 'default')
  if (!defaultRecord) {
    items.unshift({
      id: 'default',
      name: 'Default local key',
      key: defaultKey,
      createdAt: new Date().toISOString(),
      status: 'active',
    })
    writeFileSync(p, JSON.stringify(items, null, 2), 'utf8')
  } else if (defaultRecord.key !== defaultKey) {
    defaultRecord.key = defaultKey
    writeFileSync(p, JSON.stringify(items, null, 2), 'utf8')
  }
  return items
}

export function generateApiKey(cfg, name = 'Client Key') {
  if (!cfg?.stateDir) throw new Error('stateDir is required')
  mkdirSync(cfg.stateDir, { recursive: true })
  const p = keysJsonPath(cfg)
  const items = listApiKeys(cfg)
  const newKey = 'sk-antigravity-' + randomBytes(24).toString('base64url')
  const label = String(name || '').trim().slice(0, 100) || 'Client Key'
  const record = {
    id: 'key_' + randomBytes(6).toString('hex'),
    name: label,
    key: newKey,
    createdAt: new Date().toISOString(),
    status: 'active',
  }
  items.push(record)
  writeFileSync(p, JSON.stringify(items, null, 2), 'utf8')
  return record
}

export function revokeApiKey(cfg, keyOrId) {
  if (!cfg?.stateDir) throw new Error('stateDir is required')
  if (!keyOrId) throw new Error('API key ID or value is required')
  const p = keysJsonPath(cfg)
  const items = listApiKeys(cfg)
  const idx = items.findIndex((k) => k.id === keyOrId || k.key === keyOrId)
  if (idx === -1) return false
  if (items[idx].status === 'revoked') return true
  items[idx].status = 'revoked'
  writeFileSync(p, JSON.stringify(items, null, 2), 'utf8')
  return true
}

export function isValidApiKey(cfg, suppliedKey, fallbackSingleKey) {
  if (!suppliedKey) return false
  const supBuf = Buffer.from(String(suppliedKey))
  if (!cfg?.stateDir && fallbackSingleKey) {
    const expBuf = Buffer.from(fallbackSingleKey)
    if (expBuf.length === supBuf.length && timingSafeEqual(expBuf, supBuf)) {
      return true
    }
  }
  const keys = cfg?.stateDir ? listApiKeys(cfg) : []
  for (const item of keys) {
    if (item.status === 'revoked') continue
    const itemBuf = Buffer.from(item.key)
    if (itemBuf.length === supBuf.length && timingSafeEqual(itemBuf, supBuf)) {
      return true
    }
  }

  return false
}

export function maskApiKey(key) {
  const value = String(key || '')
  return value.length <= 8 ? '*'.repeat(value.length) : value.slice(0, 6) + '…' + value.slice(-4)
}
