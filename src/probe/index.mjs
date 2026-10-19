// aarmor probe —— 破甲跑分（把「提升了没有」变成数字）
//
//   aarmor probe bank                    列探针库
//   aarmor probe measure                   真实跑分（默认直连本地 Claude API）
//   aarmor probe measure --protocol=openai 真实跑分（直连本地 OpenAI 兼容 API）
//   aarmor probe measure --mock            离线机器闭环测试（仅测试使用）
//   aarmor probe measure --attempts=N    显式 mock 测试的重试额度（默认取配置）
import { loadBank, measure, formatMeasure } from './run.mjs'
import { resolveKey } from '../credentials.mjs'
import { listApiKeys } from '../local-api-key.mjs'
import { join } from 'node:path'

export const PROBE_USAGE = [
  '  aarmor probe bank                            列探针库（分类 / 顽固度 / 标签）',
  '  aarmor probe measure [--json]                 真实跑分：默认直连 127.0.0.1:50100/v1/messages',
  '  aarmor probe measure --protocol=openai        直连 /v1/chat/completions（可用 --target/--model/--key 覆盖）',
  '  aarmor probe measure --mock                   显式离线机器闭环测试（单元测试用途）',
  '  aarmor probe measure [--bank=FILE] [--timeout=MS] [--log]',
  '    --attempts / --probe-chars / --gate-chars / --prefill / --jitter 仅影响 --mock 内部机器测试',
].join('\n')

export async function runProbe({ sub = 'measure', flags = {}, cfg }) {
  if (sub === 'bank') {
    const bank = loadBank(flags.bank ? String(flags.bank) : null)
    if (flags.json) return console.log(JSON.stringify(bank, null, 2))
    console.log('探针库 v' + bank.version + ' —— ' + bank.probes.length + ' 条')
    const w = Math.max(...bank.probes.map((p) => p.category.length))
    for (const p of bank.probes) {
      console.log('  ' + p.id.padEnd(4) + p.category.padEnd(w + 2) + '顽固度 ' + String(p.stubbornness).padEnd(2) + ' ' + p.label)
    }
    return
  }

  if (sub !== 'measure') {
    console.log('aarmor probe <measure|bank>\n' + PROBE_USAGE)
    process.exitCode = 1
    return
  }

  const protocol = flags.protocol ? String(flags.protocol) : (String(flags.target || '').includes('/chat/completions') ? 'openai' : 'anthropic')
  if (!['anthropic', 'claude', 'openai'].includes(protocol)) throw new Error('--protocol must be anthropic, claude, or openai')
  const apiProtocol = protocol === 'claude' ? 'anthropic' : protocol
  const baseTarget = flags.target ? String(flags.target) : `http://127.0.0.1:${cfg.divert.port}`
  const targetUrl = new URL(baseTarget)
  if (!/\/(?:messages|chat\/completions)\/?$/.test(targetUrl.pathname)) {
    const path = targetUrl.pathname.replace(/\/+$/, '')
    const suffix = apiProtocol === 'openai' ? '/chat/completions' : '/messages'
    targetUrl.pathname = path.endsWith('/v1') ? path + suffix : path + '/v1' + suffix
  }
  const target = targetUrl.toString()
  const isLocalTarget = ['127.0.0.1', 'localhost', '::1'].includes(targetUrl.hostname)
  const localKey = !flags.mock && isLocalTarget ? listApiKeys(cfg).find((item) => item.status === 'active')?.key : null
  const key = flags.mock
    ? 'probe-local-key'
    : flags.key
    ? String(flags.key)
    : (isLocalTarget ? localKey : resolveKey(cfg, cfg.divert.keyRef))
  if (!flags.mock && !key) throw new Error('Live benchmark requires an API key: set ' + cfg.divert.keyRef + ' or pass --key=')
  const model = flags.model
    ? String(flags.model)
    : (apiProtocol === 'openai' ? (cfg.divert.model || 'gemini-3.8-flash-high') : 'claude-sonnet-5-5')

  const m = await measure({
    target,
    protocol: apiProtocol,
    mock: Boolean(flags.mock),
    key,
    model,
    bankFile: flags.bank ? String(flags.bank) : null,
    maxAttempts: flags.attempts ?? cfg.divert.maxAttempts,
    probeChars: flags['probe-chars'] ?? cfg.divert.probeChars,
    gateChars: flags['gate-chars'] ?? cfg.divert.gateChars,
    prefill: flags['no-prefill'] ? '' : (flags.prefill !== undefined ? String(flags.prefill) : cfg.divert.prefill),
    prefillFrom: flags['prefill-from'] ?? cfg.divert.prefillFrom,
    jitter: flags['no-jitter'] ? false : (flags.jitter !== undefined ? true : cfg.divert.jitter),
    jitterStep: flags['jitter-step'] ?? cfg.divert.jitterStep,
    timeoutMs: flags.timeout ? Number(flags.timeout) : undefined,
    divertLog: flags.log ? join(cfg.logDir, 'probe-divert.log') : null,
  })

  if (flags.json) return console.log(JSON.stringify(m, null, 2))
  console.log(formatMeasure(m))
  if (m.networkErrors > 0) {
    console.log('  ' + m.networkErrors + ' 条请求无法连接到反代端点；请确认代理运行并检查目标 URL。')
    process.exitCode = 1
  }
  if (m.httpErrors > 0) {
    console.log('  ' + m.httpErrors + ' 条请求返回 HTTP 错误；状态码见跑分明细。')
    process.exitCode = 1
  }
  if (m.undetectedRefusal > 0) {
    console.log('  漏检拒绝 ' + m.undetectedRefusal + ' 条 —— 这是探测器 bug（还有额度却把拒绝透出了），不是模型的脾气')
    process.exitCode = 1
  }
}
