import { join } from 'node:path'
import { readJson, writeText } from './util/fs.mjs'

export const CLAUDE_GEMINI_MODEL_OPTIONS = [
  'gemini-3.8-flash',
  'gemini-3.8-flash-high',
  'gemini-3.1-pro',
  'gemini-3.1-pro-high',
]

export const CLAUDE_MODEL_MAPPING_OPTIONS = [
  { id: 'claude-haiku-5-5', family: 'Haiku', level: 'L1', defaultModel: 'gemini-3.8-flash' },
  { id: 'claude-sonnet-5-5', family: 'Sonnet', level: 'L2', defaultModel: 'gemini-3.8-flash-high' },
  { id: 'claude-opus-5-5', family: 'Opus', level: 'L3', defaultModel: 'gemini-3.1-pro' },
  { id: 'claude-fable-5-1', family: 'Fable', level: 'L4', defaultModel: 'gemini-3.1-pro-high' },
  { id: 'claude-mythos-5-1', family: 'Mythos', level: 'L5', defaultModel: 'gemini-3.1-pro-high' },
]

export function listClaudeModelMappings(cfg) {
  const mappings = cfg.divert?.modelMapping || {}
  return CLAUDE_MODEL_MAPPING_OPTIONS.map(({ id, family, level, defaultModel }) => ({
    claudeModel: id,
    family,
    level,
    googleModel: mappings[id]?.googleModel || defaultModel,
  }))
}

export function setClaudeModelMapping(cfg, claudeModel, googleModel) {
  const option = CLAUDE_MODEL_MAPPING_OPTIONS.find((item) => item.id === claudeModel)
  if (!option) throw new Error('Unsupported Claude model alias: ' + claudeModel)
  if (!CLAUDE_GEMINI_MODEL_OPTIONS.includes(googleModel)) {
    throw new Error('Unsupported Google model: ' + googleModel)
  }

  const configPath = join(cfg.projectRoot, 'armor.config.json')
  const document = readJson(configPath)
  if (!document.divert) document.divert = {}
  if (!document.divert.modelMapping) document.divert.modelMapping = {}
  document.divert.modelMapping[claudeModel] = {
    ...document.divert.modelMapping[claudeModel],
    backend: 'antigravity',
    googleModel,
    family: option.family,
  }
  writeText(configPath, JSON.stringify(document, null, 2) + '\n')

  return { claudeModel, family: option.family, level: option.level, googleModel }
}
