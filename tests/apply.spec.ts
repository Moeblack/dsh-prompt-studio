import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { PromptStudioView } from '../src/client/PromptStudioView.tsx'
import type { PromptStudioViewInjected } from '../src/client/PromptStudioView.tsx'

interface Registered {
  options: Record<string, unknown>
  component: unknown
}

function bench() {
  const ctx = new Context()
  const registered: Registered[] = []
  const injections: Array<{ name: string; run: () => unknown }> = []
  const disposers: Array<() => void> = []
  ctx.provide('slots', {
    register: (options: Record<string, unknown>, component: unknown) => {
      registered.push({ options, component })
      const dispose = (): void => {
        const index = registered.findIndex(entry => entry.options === options)
        if (index >= 0) registered.splice(index, 1)
      }
      disposers.push(dispose)
      return dispose
    },
    inject: (name: string, run: () => unknown) => {
      injections.push({ name, run })
      return () => undefined
    },
  } as never)
  ctx.provide('conversation', {} as never)
  ctx.provide('connection', {} as never)
  const remoteHandlers = new Map<string, (namespace: string) => void>()
  ctx.provide('remote', {
    $on: (event: string, handler: (namespace: string) => void) => {
      remoteHandlers.set(event, handler)
      return () => { remoteHandlers.delete(event) }
    },
  } as never)
  const fiber = ctx.plugin({ name: 'prompt-studio-client', inject: [...inject], apply })
  return { ctx, fiber, registered, injections, remoteHandlers }
}

describe('Prompt Studio browser apply', () => {
  it('registers one session-scoped tab and keeps controllers isolated by session', async () => {
    const { fiber, registered } = bench()
    await fiber.await()
    const entry = registered.find(candidate => candidate.options.name === 'conversation.view')
    expect(entry?.component).toBe(PromptStudioView)
    expect(entry?.options).toMatchObject({ id: 'prompt-studio', order: 20, label: 'Prompt Studio' })
    const injectFace = entry?.options.inject as unknown as (sessionId: string) => PromptStudioViewInjected
    const a1 = injectFace('session-a')
    const a2 = injectFace('session-a')
    const b = injectFace('session-b')
    expect(a1).toBe(a2)
    expect(a1.controller).not.toBe(b.controller)
    expect(a1.hooks.snapshot).toBe(a1.controller.store)
  })

  it('declares the settings section only once its parent declares it', async () => {
    const { fiber, registered, injections } = bench()
    await fiber.await()
    expect(injections.map(entry => entry.name)).toEqual(['settings.section'])
    injections[0]?.run()
    const section = registered.find(candidate => candidate.options.name === 'settings.section')
    expect(section?.options).toMatchObject({ name: 'settings.section', id: 'prompt-studio' })
    expect(registered.filter(entry => entry.options.name === 'settings.section')).toHaveLength(1)
  })

  it('refreshes every loaded session controller on relevant invalidations', async () => {
    const { ctx, fiber, registered, remoteHandlers } = bench()
    await fiber.await()
    const injectFace = registered.find(candidate => candidate.options.name === 'conversation.view')
      ?.options.inject as unknown as (sessionId: string) => PromptStudioViewInjected
    const a = injectFace('session-a')
    const b = injectFace('session-b')
    a.controller.store.update(state => { state.status = 'ready' })
    b.controller.store.update(state => { state.status = 'ready' })
    const loadA = vi.spyOn(a.controller, 'load').mockResolvedValue()
    const loadB = vi.spyOn(b.controller, 'load').mockResolvedValue()

    const settingsUpdated = remoteHandlers.get('settings/document-updated')
    expect(settingsUpdated).toBeTypeOf('function')
    settingsUpdated?.('unrelated')
    expect(loadA).not.toHaveBeenCalled()
    settingsUpdated?.('prompt-studio')
    ctx.emit('connection/reset')
    expect(loadA).toHaveBeenCalledTimes(2)
    expect(loadB).toHaveBeenCalledTimes(2)
  })
})
