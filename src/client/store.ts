/** Browser controller for the prompt-studio settings and runtime inventory. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  PROMPT_STUDIO_RESOURCE_PATH,
  PROMPT_STUDIO_SETTINGS_PATH,
  PROMPT_STUDIO_STATE_PATH,
  validatePromptComponents,
  type CapturedContextResource,
  type CapturedPromptComponent,
  type CapturedResourceSnapshot,
  type PromptComponent,
  type PromptComponentKind,
  type PromptComponentPosition,
  type PromptComponentRole,
  type PromptStudioSettingsSnapshot,
  type RuntimePromptCatalog,
  type StudioConfig,
} from '../shared.ts'

/** Remote state consumed by the conversation view. */
export interface PromptStudioState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  writable: boolean
  revision: number
  components: readonly PromptComponent[]
  native: readonly PromptComponent[]
  assembled: readonly PromptComponent[]
  captured: readonly CapturedPromptComponent[]
  capturedSessionId: string | null
  messageCount: number
  userAnchor: number | null
  catalogRevision: number
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function objectRow(value: unknown, label: string, index: number): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`prompt-studio ${label} row ${String(index + 1)} is not an object`)
  }
  return value as Record<string, unknown>
}

const KINDS = new Set<PromptComponentKind>(['native', 'supplement'])
const POSITIONS = new Set<PromptComponentPosition>(['after_system', 'anchored', 'tail'])
const ROLES = new Set<PromptComponentRole>(['system', 'user', 'assistant'])

function decodeComponents(value: unknown, label: string, allowNative: boolean): PromptComponent[] {
  if (!Array.isArray(value)) throw new TypeError(`prompt-studio ${label} is not an array`)
  const components = value.map((entry, index): PromptComponent => {
    const candidate = objectRow(entry, label, index)
    const kind = candidate['kind']
    const position = candidate['position']
    const role = candidate['role']
    if (
      typeof candidate['id'] !== 'string'
      || typeof kind !== 'string' || !KINDS.has(kind as PromptComponentKind)
      || typeof role !== 'string' || !ROLES.has(role as PromptComponentRole)
      || (role === 'system'
        ? position !== undefined && position !== 'after_system'
        : typeof position !== 'string' || !POSITIONS.has(position as PromptComponentPosition))
      || typeof candidate['order'] !== 'number'
      || typeof candidate['enabled'] !== 'boolean'
      || typeof candidate['template'] !== 'string'
      || (candidate['origin'] !== undefined && typeof candidate['origin'] !== 'string')
      || (candidate['blockType'] !== undefined && candidate['blockType'] !== 'text' && candidate['blockType'] !== 'reasoning')
    ) {
      throw new TypeError(`prompt-studio ${label} row ${String(index + 1)} has an invalid shape`)
    }
    const component: PromptComponent = {
      id: candidate['id'],
      kind: kind as PromptComponentKind,
      role: role as PromptComponentRole,
      order: candidate['order'],
      enabled: candidate['enabled'],
      template: candidate['template'],
      ...candidate['origin'] === undefined ? {} : { origin: candidate['origin'] as string },
      ...candidate['blockType'] === undefined ? {} : { blockType: candidate['blockType'] as 'text' | 'reasoning' },
    }
    if (component.role !== 'system') component.position = position as PromptComponentPosition
    return component
  })
  validatePromptComponents(components, allowNative)
  return components
}

function decodeConfig(value: unknown): StudioConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('prompt-studio settings value is not an object')
  }
  const candidate = value as { components?: unknown }
  return { components: decodeComponents(candidate.components, 'components', false) }
}

function decodeCapturedResources(value: unknown, row: number): CapturedContextResource[] {
  if (!Array.isArray(value)) throw new TypeError(`prompt-studio captured row ${String(row + 1)} resources is not an array`)
  return value.map((entry, index) => {
    const candidate = objectRow(entry, 'captured resource', index)
    const action = candidate['action']
    if (
      typeof candidate['id'] !== 'string'
      || typeof candidate['path'] !== 'string'
      || (action !== 'set' && action !== 'replace' && action !== 'remove')
      || (candidate['digest'] !== undefined && typeof candidate['digest'] !== 'string')
      || typeof candidate['editable'] !== 'boolean'
    ) {
      throw new TypeError(`prompt-studio captured row ${String(row + 1)} resource ${String(index + 1)} has an invalid shape`)
    }
    return {
      id: candidate['id'],
      path: candidate['path'],
      action,
      ...candidate['digest'] === undefined ? {} : { digest: candidate['digest'] as string },
      editable: candidate['editable'],
    }
  })
}

function decodeCaptured(value: unknown): CapturedPromptComponent[] {
  if (!Array.isArray(value)) throw new TypeError('prompt-studio captured catalog is not an array')
  return value.map((entry, index) => {
    const candidate = objectRow(entry, 'captured catalog', index)
    const source = candidate['source']
    const role = candidate['role']
    if (
      typeof candidate['id'] !== 'string'
      || candidate['kind'] !== 'captured'
      || typeof role !== 'string' || !ROLES.has(role as PromptComponentRole)
      || typeof candidate['order'] !== 'number' || !Number.isSafeInteger(candidate['order'])
      || candidate['enabled'] !== true
      || typeof candidate['template'] !== 'string'
      || typeof candidate['messageId'] !== 'string'
      || typeof candidate['sourceKind'] !== 'string'
      || typeof candidate['producer'] !== 'string'
      || (candidate['form'] !== undefined && typeof candidate['form'] !== 'string')
      || (candidate['summary'] !== undefined && typeof candidate['summary'] !== 'string')
      || typeof source !== 'object' || source === null || Array.isArray(source)
    ) {
      throw new TypeError(`prompt-studio captured catalog row ${String(index + 1)} has an invalid shape`)
    }
    return {
      id: candidate['id'],
      kind: 'captured',
      role: role as PromptComponentRole,
      order: candidate['order'],
      enabled: true,
      template: candidate['template'],
      messageId: candidate['messageId'],
      sourceKind: candidate['sourceKind'],
      producer: candidate['producer'],
      ...candidate['form'] === undefined ? {} : { form: candidate['form'] as string },
      ...candidate['summary'] === undefined ? {} : { summary: candidate['summary'] as string },
      source: structuredClone(source as Record<string, unknown>),
      resources: decodeCapturedResources(candidate['resources'], index),
    }
  })
}

function decodeCatalog(value: unknown): RuntimePromptCatalog {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('prompt-studio runtime catalog is not an object')
  }
  const candidate = value as {
    revision?: unknown
    native?: unknown
    assembled?: unknown
    sessionId?: unknown
    captured?: unknown
    layout?: unknown
  }
  if (typeof candidate.revision !== 'number' || !Number.isSafeInteger(candidate.revision)) {
    throw new TypeError('prompt-studio runtime catalog has an invalid revision')
  }
  if (candidate.sessionId !== undefined && typeof candidate.sessionId !== 'string') {
    throw new TypeError('prompt-studio runtime catalog has an invalid session id')
  }
  const layout = objectRow(candidate.layout, 'request layout', 0)
  if (!Number.isSafeInteger(layout['messageCount']) || (layout['messageCount'] as number) < 0) {
    throw new TypeError('prompt-studio runtime catalog has an invalid message count')
  }
  if (layout['userAnchor'] !== null && (!Number.isSafeInteger(layout['userAnchor']) || (layout['userAnchor'] as number) < 0)) {
    throw new TypeError('prompt-studio runtime catalog has an invalid user anchor')
  }
  return {
    revision: candidate.revision,
    native: decodeComponents(candidate.native, 'native catalog', true),
    assembled: decodeComponents(candidate.assembled, 'assembled catalog', true),
    ...candidate.sessionId === undefined ? {} : { sessionId: candidate.sessionId },
    captured: decodeCaptured(candidate.captured),
    layout: {
      messageCount: layout['messageCount'] as number,
      userAnchor: layout['userAnchor'] as number | null,
    },
  }
}

function decodeSettings(value: unknown): PromptStudioSettingsSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('prompt-studio settings snapshot is not an object')
  }
  const candidate = value as Record<string, unknown>
  if (typeof candidate['writable'] !== 'boolean') {
    throw new TypeError('prompt-studio settings writable flag is invalid')
  }
  if (typeof candidate['revision'] !== 'number' || !Number.isSafeInteger(candidate['revision'])) {
    throw new TypeError('prompt-studio settings revision is invalid')
  }
  return {
    writable: candidate['writable'],
    revision: candidate['revision'],
    value: decodeConfig(candidate['value']),
  }
}

function decodeResource(value: unknown): CapturedResourceSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('prompt-studio captured resource is not an object')
  }
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate['path'] !== 'string'
    || typeof candidate['content'] !== 'string'
    || typeof candidate['digest'] !== 'string'
  ) {
    throw new TypeError('prompt-studio captured resource has an invalid shape')
  }
  return {
    path: candidate['path'],
    content: candidate['content'],
    digest: candidate['digest'],
  }
}

async function responseValue(response: Response): Promise<unknown> {
  const value = await response.json() as unknown
  if (response.ok) return value
  const message = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)['error']
    : undefined
  throw new Error(typeof message === 'string' ? message : `请求失败：HTTP ${String(response.status)}`)
}

async function loadSettings(): Promise<PromptStudioSettingsSnapshot> {
  const response = await fetch(PROMPT_STUDIO_SETTINGS_PATH, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  return decodeSettings(await responseValue(response))
}

async function loadCatalog(sessionId?: string): Promise<RuntimePromptCatalog> {
  const path = sessionId === undefined
    ? PROMPT_STUDIO_STATE_PATH
    : `${PROMPT_STUDIO_STATE_PATH}?sessionId=${encodeURIComponent(sessionId)}`
  const response = await fetch(path, {
    method: 'GET',
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  return decodeCatalog(await responseValue(response))
}

/** One browser-side controller, shared by every session-scoped mount of the view. */
export class PromptStudioStore {
  /** Observable remote namespace state consumed by every mounted Prompt Studio view. */
  readonly store: SnapshotStore<PromptStudioState> = createSnapshotStore<PromptStudioState>({
    status: 'idle',
    error: null,
    writable: false,
    revision: 0,
    components: [],
    native: [],
    assembled: [],
    captured: [],
    capturedSessionId: null,
    messageCount: 0,
    userAnchor: null,
    catalogRevision: 0,
  })

  private generation = 0

  constructor(private readonly sessionId?: string) {}

  /** Refetch the namespace descriptor and runtime registry; newest request wins. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    try {
      const [settings, catalog] = await Promise.all([
        loadSettings(),
        loadCatalog(this.sessionId),
      ])
      if (generation !== this.generation) return
      this.accept(settings, catalog)
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
    }
  }

  /** Persist one unified component draft with stale-editor protection. */
  async save(components: readonly PromptComponent[], expectedRevision: number): Promise<void> {
    validatePromptComponents(components)
    const generation = ++this.generation
    const response = await fetch(PROMPT_STUDIO_SETTINGS_PATH, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        components: components.map(component => ({ ...component })),
        expectedRevision,
      }),
    })
    const settings = decodeSettings(await responseValue(response))
    const catalog = await loadCatalog(this.sessionId)
    if (generation !== this.generation) return
    this.accept(settings, catalog)
  }

  /** Load one raw file selected by a captured instructions-form context. */
  async loadResource(componentId: string, resourceId: string): Promise<CapturedResourceSnapshot> {
    const sessionId = this.requireCapturedSession()
    const query = new URLSearchParams({ sessionId, componentId, resourceId })
    const response = await fetch(`${PROMPT_STUDIO_RESOURCE_PATH}?${query.toString()}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    return decodeResource(await responseValue(response))
  }

  /** Write one captured source file; its producer remains responsible for next-step reconciliation. */
  async saveResource(
    componentId: string,
    resourceId: string,
    content: string,
    expectedDigest: string,
  ): Promise<CapturedResourceSnapshot> {
    const sessionId = this.requireCapturedSession()
    const response = await fetch(PROMPT_STUDIO_RESOURCE_PATH, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sessionId, componentId, resourceId, content, expectedDigest }),
    })
    return decodeResource(await responseValue(response))
  }

  private requireCapturedSession(): string {
    const sessionId = this.store.getSnapshot().capturedSessionId
    if (sessionId === null) throw new Error('当前没有已捕获请求所属的会话。')
    return sessionId
  }

  private accept(
    settings: PromptStudioSettingsSnapshot,
    catalog: RuntimePromptCatalog,
  ): void {
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.writable = settings.writable
      state.revision = settings.revision
      state.components = settings.value.components
      state.native = catalog.native
      state.assembled = catalog.assembled
      state.captured = catalog.captured
      state.capturedSessionId = catalog.sessionId ?? null
      state.messageCount = catalog.layout.messageCount
      state.userAnchor = catalog.layout.userAnchor
      state.catalogRevision = catalog.revision
    })
  }
}

/** Refresh only after the user has opened the view once. */
export function refreshIfLoaded(controller: PromptStudioStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}
