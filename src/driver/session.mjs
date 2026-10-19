// 会话驱动：agentapi 发消息 + 直接读 SQLite 拿回复
//
// v1.7.1 修：会话目录**不止一个**。实测本机同时存在
//   ~/.gemini/antigravity/conversations/       ← IDE 实际在写的那个
//   ~/.gemini/antigravity-ide/conversations/   ← 旧版/另一条入口，本项目此前只读它
// 只认一个根就会出现「刚聊完的会话，aarmor drive list 里看不到」——
// 用户报「看下最新对话记录」时就是这么被挡住的。现在两个根都扫，按 mtime 合并排序。
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../log.mjs'
import { ensureWorkspaceProject } from '../workspace-project.mjs'

/** 会话根目录（来自配置 convRoots；缺省兼容旧字段与两种默认布局） */
export function convRoots(cfg) {
  const list = cfg.paths?.convRoots
  if (Array.isArray(list) && list.length) return list.map((p) => p.replace(/^~/, process.env.USERPROFILE || ''))
  return [
    join(cfg.geminiHome, 'antigravity', 'conversations'),
    join(cfg.geminiHome, 'antigravity-ide', 'conversations'),
  ]
}

export function convDir(cfg) { return convRoots(cfg)[0] }

/** 在全部会话根里找这个 id 的库文件 */
export function convDb(cfg, id) {
  for (const root of convRoots(cfg)) {
    const p = join(root, id + '.db')
    if (existsSync(p)) return p
  }
  return join(convRoots(cfg)[0], id + '.db')
}

/** 调 agentapi（LS 必须在跑，且 env 指向它的 HTTP 端口） */
export function agentapi(cfg, args, { httpPort, csrf = 'aarmor', projectId, cwd } = {}) {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    if (k.startsWith('ANTIGRAVITY_') || /CONVERSATION|METADATA|TRAJECTORY|SENDER|PARENT_AGENT|SUBAGENT|AGENT_ID|TASK_ID/i.test(k)) {
      delete env[k]
    }
  }
  env.ANTIGRAVITY_LS_ADDRESS = '127.0.0.1:' + httpPort
  env.ANTIGRAVITY_CSRF_TOKEN = csrf
  const resolvedProjectId = projectId || ensureWorkspaceProject(cfg)?.projectId
  if (resolvedProjectId) env.ANTIGRAVITY_PROJECT_ID = resolvedProjectId
  let out
  try {
    out = execFileSync(cfg.binaryPath, ['agentapi', ...args], { env, cwd, encoding: 'utf8', timeout: 300000, windowsHide: true })
  } catch (error) {
    const prompt = args.at(-1)
    let rawErr = (error.stderr ? String(error.stderr) : (error.stdout ? String(error.stdout) : '')).trim()
    try {
      const parsed = JSON.parse(rawErr)
      if (parsed.error) rawErr = parsed.error
    } catch {}
    let detail = rawErr
    if (prompt) detail = detail.replaceAll(String(prompt), '<prompt redacted>')
    detail = detail
      .replace(/\bya29\.[A-Za-z0-9._-]+/g, '<token redacted>')
      .replace(/Bearer\s+\S+/gi, 'Bearer <token redacted>')
      .replace(/\s+/g, ' ')
      .slice(0, 240)
    const status = error.status ?? error.code ?? 'unknown'
    throw new Error('agentapi exited (' + status + ')' + (detail ? ': ' + detail : ''))
  }
  try { return JSON.parse(out) } catch { return { raw: out } }
}

export function newConversation(cfg, prompt, opts = {}) {
  const res = agentapi(cfg, ['new-conversation', '--model=' + (opts.model || 'flash'), prompt], opts)
  const id = res?.response?.newConversation?.conversationId
  return { id, raw: res }
}

export function sendMessage(cfg, recipientId, content, opts = {}) {
  return agentapi(cfg, ['send-message', recipientId, content], opts)
}

export function listConversations(cfg, limit = 10) {
  const out = []
  for (const d of convRoots(cfg)) {
    if (!existsSync(d)) continue
    for (const f of readdirSync(d).filter((x) => /^[0-9a-f-]{36}\.db$/i.test(x))) {
      const p = join(d, f)
      try {
        const stat = statSync(p)
        out.push({
          id: f.replace(/\.db$/, ''),
          path: p,
          root: d,
          createdAt: stat.birthtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          mtime: stat.mtimeMs,
        })
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}

/** 读会话步骤。type: 14=用户消息 15=模型输出 90=注入的 ephemeral message */
export async function readSteps(dbPath, { types = null } = {}) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='steps'").get()
    if (!hasTable) return []
    let rows = db.prepare('SELECT idx, step_type, status, step_payload FROM steps ORDER BY idx').all()
    if (types) rows = rows.filter((r) => types.includes(r.step_type))
    return rows.map((r) => ({
      idx: r.idx, type: r.step_type, status: r.status, bytes: r.step_payload ? r.step_payload.length : 0,
      text: r.step_payload ? Buffer.from(r.step_payload).toString('utf8').replace(/[^\x20-\x7e\u4e00-\u9fff\n]/g, ' ').replace(/\s{2,}/g, ' ').trim() : '',
    }))
  } finally {
    db.close()
  }
}

export async function readReply(cfg, conversationId) {
  const steps = await readSteps(convDb(cfg, conversationId), { types: [15] })
  return steps.map((s) => s.text).join('\n')
}

export function extractUserPromptFromPayload(buf) {
  if (!buf) return ''
  const str = Buffer.from(buf).toString('utf8')
  const matches = str.match(/[\x20-\x7e\u4e00-\u9fff\r\n\t]{4,}/g) || []
  const filtered = matches.filter((s) => !/^[0-9a-f-]{36}$/i.test(s.trim()) && !s.includes('sessionID') && !s.includes('bot-'))
  if (filtered.length > 0) {
    filtered.sort((a, b) => b.length - a.length)
    return filtered[0].trim()
  }
  return str.replace(/[^\x20-\x7e\u4e00-\u9fff\n]/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

export async function getConversationDetails(cfg, convId) {
  if (typeof convId !== 'string' || !/^[0-9a-f-]{36}$/i.test(convId)) {
    throw new Error('Invalid conversation ID')
  }
  const dbPath = convDb(cfg, convId)
  if (!existsSync(dbPath)) return null
  const { DatabaseSync } = await import('node:sqlite')
  const { extractCleanAssistantReply } = await import('../layers/divert.mjs')
  const stat = statSync(dbPath)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  let rows = []
  try {
    const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='steps'").get()
    if (hasTable) {
      rows = db.prepare('SELECT idx, step_type, status, step_payload FROM steps ORDER BY idx').all()
    }
  } finally {
    db.close()
  }

  const messages = []
  for (const r of rows) {
    if (!r.step_payload) continue
    const buf = Buffer.from(r.step_payload)
    if (r.step_type === 14) {
      const text = extractUserPromptFromPayload(buf)
      if (text) messages.push({ role: 'user', text, idx: r.idx })
    } else if (r.step_type === 15) {
      const text = extractCleanAssistantReply(buf)
      if (text) messages.push({ role: 'assistant', text, idx: r.idx, status: r.status })
    }
  }
  return {
    id: convId,
    dbPath,
    createdAt: stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    turns: messages.filter((m) => m.role === 'user').length,
    messageCount: messages.length,
    messages,
  }
}

export function getConversationDetail(cfg, convId) {
  return getConversationDetails(cfg, convId)
}

export async function getConversationSummaries(cfg, limit = Infinity) {
  const convs = listConversations(cfg, limit)
  const summaries = []
  for (const c of convs) {
    try {
      const details = await getConversationDetails(cfg, c.id)
      const firstUserMsg = details?.messages.find((m) => m.role === 'user')
      const snippet = firstUserMsg ? firstUserMsg.text.slice(0, 80) : '(无文本输入)'
      summaries.push({
        id: c.id,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        mtime: c.mtime,
        turns: details?.turns || 0,
        messageCount: details?.messages.length || 0,
        snippet,
      })
    } catch (error) {
      summaries.push({
        id: c.id,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        mtime: c.mtime,
        turns: 0,
        messageCount: 0,
        snippet: '(无法读取)',
        error: error.message,
      })
    }
  }
  return summaries
}
