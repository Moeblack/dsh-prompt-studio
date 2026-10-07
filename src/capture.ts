/** Pure classification of actual request messages into Prompt Studio context rows. */
import type { ContentBlock, RequestMessage } from '@deepseek-ai/dsh-llm'
import {
  type CapturedContextResource,
  type CapturedPromptComponent,
  type PromptComponentRole,
  type RuntimeRequestLayout,
} from './shared.ts'

const CONVERSATION_SOURCE_KINDS = new Set(['user', 'model', 'tool'])

/**
 * Request-message roles outside the editor's three-role model render as the
 * user-role context they are; only an assistant message keeps its own role.
 */
function capturedRole(message: RequestMessage): PromptComponentRole {
  if (message.role === 'assistant') return 'assistant'
  return message.role === 'system' ? 'system' : 'user'
}

/** The producer metadata of one request message, or undefined for identity-free user input. */
function sourceRecord(message: RequestMessage): Record<string, unknown> | undefined {
  if (message.source === undefined) return undefined
  return structuredClone(message.source) as unknown as Record<string, unknown>
}

function blockText(block: ContentBlock): string {
  const record = block as unknown as Record<string, unknown>
  if ((block.type === 'text' || block.type === 'reasoning') && typeof record['text'] === 'string') {
    return record['text']
  }
  return JSON.stringify(block, null, 2)
}

function renderMessageContent(message: RequestMessage): string {
  return message.content.map(blockText).join('\n\n')
}

function instructionResources(source: Record<string, unknown>): CapturedContextResource[] {
  if (source['form'] !== 'instructions' || !Array.isArray(source['changes'])) return []
  const resources: CapturedContextResource[] = []
  for (const change of source['changes']) {
    if (typeof change !== 'object' || change === null || Array.isArray(change)) continue
    const record = change as Record<string, unknown>
    const action = record['action']
    const path = record['path']
    const digest = record['digest']
    if ((action !== 'set' && action !== 'replace' && action !== 'remove') || typeof path !== 'string') continue
    resources.push({
      id: `resource:${String(resources.length)}`,
      path,
      action,
      ...typeof digest === 'string' ? { digest } : {},
      editable: action !== 'remove' && typeof digest === 'string',
    })
  }
  return resources
}

/** Whether one request message carries producer-owned context rather than conversation. */
export function isInjectedContextMessage(message: RequestMessage): boolean {
  const source = sourceRecord(message)
  if (source === undefined) return false
  const kind = source['kind']
  return typeof kind === 'string' && !CONVERSATION_SOURCE_KINDS.has(kind)
}

/** Capture every producer-owned context message without knowing its plugin kind in advance. */
export function captureInjectedMessages(messages: readonly RequestMessage[]): CapturedPromptComponent[] {
  return messages.flatMap((message, order): CapturedPromptComponent[] => {
    const source = sourceRecord(message)
    if (source === undefined || !isInjectedContextMessage(message)) return []
    const sourceKind = String(source['kind'])
    const plugin = source['plugin']
    const form = source['form']
    const summary = source['summary']
    return [{
      id: `captured:${String(message.id)}`,
      kind: 'captured',
      role: capturedRole(message),
      order,
      enabled: true,
      template: renderMessageContent(message),
      messageId: String(message.id),
      sourceKind,
      producer: typeof plugin === 'string' ? plugin : sourceKind,
      ...typeof form === 'string' ? { form } : {},
      ...typeof summary === 'string' ? { summary } : {},
      source,
      resources: instructionResources(source),
    }]
  })
}

/** Describe the unmodified request gaps used by supplement placement. */
export function requestLayout(messages: readonly RequestMessage[]): RuntimeRequestLayout {
  let userAnchor: number | null = null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user' && message.source?.kind === 'user') {
      userAnchor = index
      break
    }
  }
  return { messageCount: messages.length, userAnchor }
}
