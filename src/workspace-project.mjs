import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

function normalizedPath(path) {
  return resolve(path).replace(/[\\/]+$/, '').toLowerCase()
}

function registeredWorkspace(project) {
  const resources = project.projectResources?.resources
  if (!Array.isArray(resources)) return []
  return resources.flatMap((resource) => {
    const uri = resource.folderUri || resource.gitFolder?.folderUri
    if (typeof uri !== 'string' || !uri.startsWith('file:')) return []
    try { return [fileURLToPath(new URL(uri))] } catch { return [] }
  })
}

function deterministicProjectId(workspace) {
  const namespace = Buffer.from('f85d30c2b4b94c65a8a16bcedd177298', 'hex')
  const id = createHash('sha1').update(namespace).update(normalizedPath(workspace)).digest().subarray(0, 16)
  id[6] = (id[6] & 0x0f) | 0x50
  id[8] = (id[8] & 0x3f) | 0x80
  const hex = id.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function workspaceProject(workspace, id) {
  const folderUri = pathToFileURL(workspace).href
  let defaultBranch = ''
  try {
    defaultBranch = execFileSync('git', ['-C', workspace, 'branch', '--show-current'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim()
  } catch {}
  const resource = defaultBranch
    ? { gitFolder: { folderUri, defaultBranch } }
    : { folderUri }
  return {
    id,
    name: basename(workspace),
    projectResources: { resources: [resource] },
    settings: {},
    isWorkspaceOnly: true,
  }
}

export function ensureWorkspaceProject(cfg, workspace = cfg?.projectRoot || process.cwd()) {
  if (!cfg?.geminiHome) return null
  const absoluteWorkspace = resolve(workspace)
  const projectsDir = resolve(cfg.geminiHome, 'config', 'projects')
  mkdirSync(projectsDir, { recursive: true })
  const wantedPath = normalizedPath(absoluteWorkspace)

  for (const name of readdirSync(projectsDir).filter((entry) => entry.endsWith('.json'))) {
    const file = resolve(projectsDir, name)
    const project = JSON.parse(readFileSync(file, 'utf8'))
    if (registeredWorkspace(project).some((path) => normalizedPath(path) === wantedPath)) {
      if (typeof project.id !== 'string' || !project.id) {
        throw new Error('Registered project has no ID: ' + file)
      }
      return { projectId: project.id, workspace: absoluteWorkspace, created: false }
    }
  }

  const projectId = deterministicProjectId(absoluteWorkspace)
  const projectFile = resolve(projectsDir, projectId + '.json')
  const project = workspaceProject(absoluteWorkspace, projectId)
  if (existsSync(projectFile)) {
    const existing = JSON.parse(readFileSync(projectFile, 'utf8'))
    if (!registeredWorkspace(existing).some((path) => normalizedPath(path) === wantedPath)) {
      throw new Error('Workspace project ID collision; refusing to replace ' + projectFile)
    }
  } else {
    writeFileSync(projectFile, JSON.stringify(project, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  }
  return { projectId, workspace: absoluteWorkspace, created: true }
}
