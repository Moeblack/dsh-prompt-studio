import { describe, expect, it } from 'vitest'
import { ToolCallId, createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { captureInjectedMessages, isInjectedContextMessage, requestLayout } from '../src/capture.ts'

describe('automatic injected-context capture', () => {
  it('classifies by producer provenance instead of a plugin allow-list', () => {
    const direct = createUserMessage({ content: [{ type: 'text', text: 'Question' }], source: { kind: 'user' } })
    const instructions = createUserMessage({
      content: [{ type: 'text', text: '<system-reminder>AGENTS</system-reminder>' }],
      source: {
        kind: 'workspace-instructions',
        form: 'instructions',
        baseline: true,
        changes: [{ action: 'set', scope: '.\u0000AGENTS.md', path: 'AGENTS.md', digest: 'abc' }],
      },
    })
    const futurePlugin = createUserMessage({
      content: [{ type: 'text', text: 'Future catalog' }],
      source: { kind: 'catalog', plugin: 'future-context', form: 'catalog' },
    })
    const tool = createUserMessage({
      content: [{ type: 'tool-result', toolCallId: ToolCallId('call-1'), content: [], isError: false }],
      source: { kind: 'tool', callId: ToolCallId('call-1') },
    })
    const model = createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Answer' }],
      source: { kind: 'model', provider: 'p', model: 'm' },
    })

    expect(isInjectedContextMessage(instructions)).toBe(true)
    expect(captureInjectedMessages([direct, instructions, futurePlugin, tool, model])).toMatchObject([
      {
        kind: 'captured',
        order: 1,
        sourceKind: 'workspace-instructions',
        producer: 'workspace-instructions',
        form: 'instructions',
        template: '<system-reminder>AGENTS</system-reminder>',
        resources: [{ id: 'resource:0', path: 'AGENTS.md', action: 'set', digest: 'abc', editable: true }],
      },
      {
        kind: 'captured',
        order: 2,
        producer: 'future-context',
        form: 'catalog',
        resources: [],
      },
    ])
  })

  it('treats unknown producer kinds as captured context and keeps the real-user anchor', () => {
    const injected = createUserMessage({
      content: [{ type: 'text', text: 'own' }],
      source: { kind: 'unknown-producer', plugin: 'some-plugin' },
    })
    const user = createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })
    expect(captureInjectedMessages([injected, user])).toMatchObject([
      { order: 0, sourceKind: 'unknown-producer', producer: 'some-plugin' },
    ])
    expect(requestLayout([injected, user])).toEqual({ messageCount: 2, userAnchor: 1 })
  })

  it('maps producer roles onto the editor role model', () => {
    const developer = createMessage({
      role: 'developer',
      content: [{ type: 'text', text: 'Tool added' }],
      source: { kind: 'developer', form: 'catalog' },
    })
    expect(captureInjectedMessages([developer])).toMatchObject([{ role: 'user', producer: 'developer' }])
  })
})
