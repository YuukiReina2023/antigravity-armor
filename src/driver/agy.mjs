// Antigravity CLI (agy) 驱动模块
// 负责直接对接 agy，注入改道代理环境变量并提供 prompt 执行、模型查询、状态审计能力
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { log } from '../log.mjs'

const execFileAsync = promisify(execFile)

/** 定位 agy 可执行文件路径 */
export function locateAgy(cfg = {}) {
  // 1. 配置显式指定
  if (cfg.agy?.bin && existsSync(cfg.agy.bin)) return cfg.agy.bin

  // 2. 环境变量
  if (process.env.AGY_BIN && existsSync(process.env.AGY_BIN)) return process.env.AGY_BIN

  // 3. 常见平台默认路径
  const candidates = []
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) {
      candidates.push(join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'))
    }
    if (process.env.USERPROFILE) {
      candidates.push(join(process.env.USERPROFILE, 'AppData', 'Local', 'agy', 'bin', 'agy.exe'))
      candidates.push(join(process.env.USERPROFILE, '.local', 'bin', 'agy.exe'))
    }
  } else {
    if (process.env.HOME) {
      candidates.push(join(process.env.HOME, '.local', 'bin', 'agy'))
      candidates.push('/usr/local/bin/agy')
    }
  }

  for (const c of candidates) {
    if (existsSync(c)) return c
  }

  // 4. 回退为直接调 'agy'（如果在 PATH 中）
  return 'agy'
}

/** 获取 agy 状态与版本 */
export async function getAgyStatus(cfg = {}) {
  const bin = locateAgy(cfg)
  try {
    const { stdout, stderr } = await execFileAsync(bin, ['--help'], { timeout: 8000 })
    const out = stdout || stderr || ''
    const hasHelp = out.includes('Usage of agy') || out.includes('agy')
    return {
      found: true,
      bin,
      help: hasHelp,
      divertEndpoint: `http://127.0.0.1:${cfg.divert?.port || 50100}`,
    }
  } catch (err) {
    return {
      found: false,
      bin,
      error: err.message,
      divertEndpoint: `http://127.0.0.1:${cfg.divert?.port || 50100}`,
    }
  }
}

/** 构造带改道代理注入的环境变量 */
export function buildAgyEnv(cfg = {}, extraEnv = {}) {
  const port = cfg.divert?.port || 50100
  const endpoint = `http://127.0.0.1:${port}`
  return {
    ...process.env,
    AICODE_ENDPOINT_URL: endpoint,
    JETSKI_SERVICE_ENDPOINT_URL: endpoint,
    AICODE_TELEMETRY_ENDPOINT_URL: endpoint,
    ...extraEnv,
  }
}

/** 驱动 agy 执行单次 prompt */
export function runPrompt(cfg, {
  prompt,
  model = null,
  mode = 'auto',
  effort = null,
  dangerouslySkipPermissions = true,
  outputFormat = 'text',
  cwd = process.cwd(),
  env = {},
  onData = null,
  onErr = null,
  timeoutMs = 120000,
} = {}) {
  const bin = locateAgy(cfg)
  const args = []

  if (dangerouslySkipPermissions) args.push('--dangerously-skip-permissions')
  if (model) args.push(`--model=${model}`)
  if (mode) args.push(`--mode=${mode}`)
  if (effort) args.push(`--effort=${effort}`)
  if (outputFormat) args.push(`--output-format=${outputFormat}`)
  args.push('--print', prompt)

  const mergedEnv = buildAgyEnv(cfg, env)

  return new Promise((resolve, reject) => {
    let stdoutData = ''
    let stderrData = ''
    let timer = null

    const p = spawn(bin, args, {
      cwd,
      env: mergedEnv,
      windowsHide: true,
    })

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        p.kill('SIGTERM')
        reject(new Error(`agy prompt execution timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }

    p.stdout.on('data', (d) => {
      const s = d.toString('utf8')
      stdoutData += s
      if (onData) onData(s)
    })

    p.stderr.on('data', (d) => {
      const s = d.toString('utf8')
      stderrData += s
      if (onErr) onErr(s)
    })

    p.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })

    p.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (code === 0) {
        resolve({ stdout: stdoutData, stderr: stderrData, code })
      } else {
        const msg = stderrData || stdoutData || `Process exited with code ${code}`
        resolve({ stdout: stdoutData, stderr: stderrData, code, failed: true, error: msg })
      }
    })
  })
}

/** 获取可用模型列表 */
export async function listModels(cfg = {}) {
  const bin = locateAgy(cfg)
  const env = buildAgyEnv(cfg)
  try {
    const { stdout } = await execFileAsync(bin, ['models'], { env, timeout: 10000 })
    return stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  } catch (err) {
    return ['gemini-2.5-flash', 'gemini-2.5-pro', 'claude-3-7-sonnet', 'deepseek-v3', 'glm-5.3']
  }
}

/** 获取可用 agents 列表 */
export async function listAgents(cfg = {}) {
  const bin = locateAgy(cfg)
  const env = buildAgyEnv(cfg)
  try {
    const { stdout } = await execFileAsync(bin, ['agents'], { env, timeout: 10000 })
    return stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  } catch (err) {
    return ['self', 'research', 'image-generator']
  }
}
