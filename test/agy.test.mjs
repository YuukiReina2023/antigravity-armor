import assert from 'node:assert/strict'
import { locateAgy, getAgyStatus, buildAgyEnv } from '../src/driver/agy.mjs'

export async function testLocateAgyFindsBinaryOrFallback() {
  const bin = locateAgy()
  assert.ok(bin && typeof bin === 'string', 'locateAgy 应返回有效的二进制路径或可执行文件名')
}

export async function testBuildAgyEnvInjectsDivertProxy() {
  const cfg = { divert: { port: 50100 } }
  const env = buildAgyEnv(cfg, { CUSTOM_TEST_VAR: '123' })
  assert.equal(env.AICODE_ENDPOINT_URL, 'http://127.0.0.1:50100')
  assert.equal(env.JETSKI_SERVICE_ENDPOINT_URL, 'http://127.0.0.1:50100')
  assert.equal(env.AICODE_TELEMETRY_ENDPOINT_URL, 'http://127.0.0.1:50100')
  assert.equal(env.CUSTOM_TEST_VAR, '123')
}

export async function testGetAgyStatusReturnsExpectedShape() {
  const cfg = { divert: { port: 50100 } }
  const st = await getAgyStatus(cfg)
  assert.ok(typeof st.found === 'boolean', 'st.found 必须为布尔值')
  assert.ok(typeof st.bin === 'string', 'st.bin 必须为字符串')
  assert.equal(st.divertEndpoint, 'http://127.0.0.1:50100')
}
