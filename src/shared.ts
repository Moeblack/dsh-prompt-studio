/** Settings namespace shared by the Host registration and browser editor. */
export const PROMPT_STUDIO_NAMESPACE = 'prompt-studio'

/** Same-origin endpoint exposing the runtime-discovered prompt inventory. */
export const PROMPT_STUDIO_STATE_PATH = '/prompt-studio/state'

/** Same-origin endpoint owned by the plugin for its private settings namespace. */
export const PROMPT_STUDIO_SETTINGS_PATH = '/prompt-studio/settings'

/** Same-origin endpoint for resources declared by captured context producers. */
export const PROMPT_STUDIO_RESOURCE_PATH = '/prompt-studio/resource'

/** Conversation-view placement: Chat is 0 and Trajectory is 10. */
export const PROMPT_STUDIO_VIEW_ORDER = 20

/** Initial order assigned to a newly added supplement. */
export const DEFAULT_SUPPLEMENT_ORDER = 100

/** Namespace reserved for ordered replacement markers owned by the Host half. */
export const PROMPT_STUDIO_OVERRIDE_MARKER_PREFIX = 'prompt-studio:override-marker:'

/** Runtime provenance is the only component-kind distinction. */
export type PromptComponentKind = 'native' | 'supplement'

/** Message-gap placement used only by user/assistant components. */
export type PromptComponentPosition = 'after_system' | 'anchored' | 'tail'

/** Model-facing role of one component. */
export type PromptComponentRole = 'system' | 'user' | 'assistant'

/** One item in the unified prompt-composition model. */
export interface PromptComponent {
  id: string
  kind: PromptComponentKind
  role: PromptComponentRole
  /** Absent for system components; required for user/assistant components. */
  position?: PromptComponentPosition
  /** System-section layer or, for messages, order within the selected gap. */
  order: number
  enabled: boolean
  template: string
  /** Native target id when this supplement overrides a runtime component. */
  origin?: string
  /** Assistant supplements: render as a reasoning or text block. Defaults to text. */
  blockType?: 'text' | 'reasoning'
}

/** Resolved value of the prompt-studio settings namespace. */
export interface StudioConfig {
  components: PromptComponent[]
}

/** Browser-safe snapshot of the plugin-owned settings namespace. */
export interface PromptStudioSettingsSnapshot {
  writable: boolean
  revision: number
  value: StudioConfig
}

/** One source-owned file transition exposed by an instructions-form context. */
export interface CapturedContextResource {
  /** Stable within the captured message. */
  id: string
  /** Producer-facing path; it remains display metadata until the Host resolves it. */
  path: string
  action: 'set' | 'replace' | 'remove'
  digest?: string
  /** True only when the semantic instructions adapter has enough facts to resolve the file. */
  editable: boolean
}

/** One non-conversation message automatically discovered in an actual model request. */
export interface CapturedPromptComponent {
  id: string
  kind: 'captured'
  role: PromptComponentRole
  /** Zero-based position in the unmodified request message sequence. */
  order: number
  enabled: true
  /** Human-readable rendering of the exact request blocks. */
  template: string
  messageId: string
  sourceKind: string
  producer: string
  form?: string
  summary?: string
  /** Complete producer metadata, retained for inspection without interpreting unknown kinds. */
  source: Record<string, unknown>
  resources: CapturedContextResource[]
}

/** Message-layout facts needed to place configured supplements around captured context. */
export interface RuntimeRequestLayout {
  messageCount: number
  /** Zero-based last true-user message index, or null when the request has none. */
  userAnchor: number | null
}

/** Runtime state returned by the Host inventory endpoint. */
export interface RuntimePromptCatalog {
  revision: number
  native: PromptComponent[]
  /** Effective system-section sequence from the latest real assembly. */
  assembled: PromptComponent[]
  /** Session selected by the request query, or the latest captured session. */
  sessionId?: string
  /** Non-user/plugin-produced request messages from that session's latest actual request. */
  captured: CapturedPromptComponent[]
  layout: RuntimeRequestLayout
}

/** Exact current bytes of an editable captured file resource. */
export interface CapturedResourceSnapshot {
  path: string
  content: string
  digest: string
}

export type NativeOverride = PromptComponent & { kind: 'supplement'; origin: string }

const KINDS = new Set<PromptComponentKind>(['native', 'supplement'])
const POSITIONS = new Set<PromptComponentPosition>(['after_system', 'anchored', 'tail'])
const ROLES = new Set<PromptComponentRole>(['system', 'user', 'assistant'])

function validateIdentifier(value: string, label: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} must be non-empty and have no surrounding whitespace`)
  }
}

/** Return whether a supplement targets one runtime-native component. */
export function isNativeOverride(component: PromptComponent): component is NativeOverride {
  return component.kind === 'supplement' && component.origin !== undefined
}

/**
 * Validate configured or runtime component rows.
 * @param components - rows to validate.
 * @param allowNative - whether runtime-only native rows are accepted.
 */
export function validatePromptComponents(
  components: readonly PromptComponent[],
  allowNative = false,
): void {
  const ids = new Set<string>()
  const overrideTargets = new Set<string>()
  for (const component of components) {
    validateIdentifier(component.id, 'prompt component ids')
    if (!KINDS.has(component.kind)) throw new TypeError(`prompt component "${component.id}" has an invalid kind`)
    if (!ROLES.has(component.role)) throw new TypeError(`prompt component "${component.id}" has an invalid role`)
    if (component.role === 'system') {
      if (component.position !== undefined) {
        throw new TypeError(`system prompt component "${component.id}" cannot define a message position`)
      }
    } else if (component.position === undefined || !POSITIONS.has(component.position)) {
      throw new TypeError(`message prompt component "${component.id}" has an invalid position`)
    }
    if (component.blockType !== undefined) {
      if (component.blockType !== 'text' && component.blockType !== 'reasoning') {
        throw new TypeError(`prompt component "${component.id}" has an invalid block type`)
      }
      if (component.role !== 'assistant') {
        throw new TypeError(`prompt component "${component.id}" blockType applies only to assistant components`)
      }
    }
    if (!Number.isFinite(component.order)) {
      throw new TypeError(`prompt component "${component.id}" order must be a finite number`)
    }
    if (component.id.startsWith(PROMPT_STUDIO_OVERRIDE_MARKER_PREFIX)) {
      throw new TypeError(`prompt component ids beginning with "${PROMPT_STUDIO_OVERRIDE_MARKER_PREFIX}" are reserved`)
    }
    if (ids.has(component.id)) throw new TypeError(`prompt component "${component.id}" is listed more than once`)
    ids.add(component.id)

    if (component.kind === 'native') {
      if (!allowNative) throw new TypeError(`native prompt component "${component.id}" cannot be persisted`)
      if (component.origin !== undefined) {
        throw new TypeError(`native prompt component "${component.id}" cannot override another component`)
      }
      if (component.role !== 'system') {
        throw new TypeError(`native prompt component "${component.id}" must use the system role`)
      }
      continue
    }

    if (component.origin === undefined) continue
    validateIdentifier(component.origin, `supplement "${component.id}" native target`)
    if (overrideTargets.has(component.origin)) {
      throw new TypeError(`native prompt component "${component.origin}" is overridden more than once`)
    }
    overrideTargets.add(component.origin)
  }
}

function uniqueComponentId(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) {
    used.add(preferred)
    return preferred
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${preferred}-${String(suffix)}`
    if (used.has(candidate)) continue
    used.add(candidate)
    return candidate
  }
}

/** Render one supplement as plain content without any wrapper markup. */
export function renderSupplementBoundary(_id: string, text: string): string {
  return text
}

interface OrderedSystemComponent {
  component: PromptComponent
  declaration: number
}

function systemPreviewComponent(component: PromptComponent): PromptComponent {
  const snapshot = {
    ...component,
    template: renderSupplementBoundary(component.id, component.template),
  }
  delete snapshot.position
  return snapshot
}

/** Resolve overrides and supplements for a draft of the single system slot. */
export function buildDraftSystemComponents(
  native: readonly PromptComponent[],
  configured: readonly PromptComponent[],
): PromptComponent[] {
  validatePromptComponents(native, true)
  validatePromptComponents(configured)
  const nativeIds = new Set(native.map(component => component.id))
  const overrides = new Map(configured
    .filter(isNativeOverride)
    .map(component => [component.origin, component]))
  const ordered: OrderedSystemComponent[] = native.flatMap((component, declaration): OrderedSystemComponent[] => {
    const override = overrides.get(component.id)
    if (override === undefined) {
      return component.enabled ? [{ component: { ...component }, declaration }] : []
    }
    return []
  })
  for (const [declaration, component] of configured.entries()) {
    if (!component.enabled || component.role !== 'system') continue
    if (component.origin !== undefined && !nativeIds.has(component.origin)) continue
    ordered.push({
      component: systemPreviewComponent(component),
      declaration: native.length + declaration,
    })
  }
  return ordered
    .sort((left, right) => left.component.order - right.component.order
      || left.declaration - right.declaration)
    .map(entry => entry.component)
}

/** Concatenate enabled system components using the Host renderer's blank-line rule. */
export function renderSystemPreview(components: readonly PromptComponent[]): string {
  return components.map(component => component.template).filter(text => text.length > 0).join('\n\n')
}

/** Allocate the first readable supplement id absent from a component draft. */
export function nextSupplementId(components: readonly PromptComponent[]): string {
  const used = new Set(components.map(component => component.id))
  return uniqueComponentId('supplement:message', used)
}

/** Allocate a readable id for a supplement overriding one native component. */
export function nextOverrideId(components: readonly PromptComponent[], target: string): string {
  const used = new Set(components.map(component => component.id))
  return uniqueComponentId(`override:${target}`, used)
}
