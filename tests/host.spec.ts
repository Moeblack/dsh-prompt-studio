import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import LlmRuntime, { createMessage, createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderContextSnapshot, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { Config, PROMPT_STUDIO_SETTINGS_NAMESPACE, apply, inject } from '../src/index.ts'
import type { PromptComponent } from '../src/shared.ts'

interface RegisteredRoute {
  path: string
  handler: (request: unknown, response: unknown) => void | Promise<void>
}

class MemoryWebServer {
  readonly routes = new Map<string, RegisteredRoute>()
  register(route: RegisteredRoute): () => void {
    this.routes.set(route.path, route)
    return () => { this.routes.delete(route.path) }
  }

  async get(path: string): Promise<{ status: number; value: unknown }> {
    return this.request('GET', path)
  }

  async request(method: string, path: string, rawBody?: string): Promise<{ status: number; value: unknown }> {
    const url = new URL(path, 'http://test')
    const route = this.routes.get(url.pathname)
    if (route === undefined) throw new Error(`missing route ${url.pathname}`)
    let status = 0
    let body = ''
    await route.handler({
      method,
      url: `${url.pathname}${url.search}`,
      on(event: string, listener: (chunk?: unknown) => void) {
        if (event === 'data' && rawBody !== undefined) listener(Buffer.from(rawBody))
        if (event === 'end') listener()
        if (event === 'error') return
      },
    }, {
      writeHead(next: number) { status = next },
      end(next?: string) { body = next ?? '' },
    })
    return { status, value: JSON.parse(body) as unknown }
  }
}

/** Minimal stand-in for the profile-entry settings service the Host half reads. */
class MemorySettings {
  revision = 0
  /** Make the next write fail the way the real service refuses a stale editor. */
  conflict = false
  /** Make the next write fail the way an unexpected internal fault would. */
  crash = false
  writes = 0

  constructor(private readonly components: readonly PromptComponent[]) {}

  get writable(): boolean { return true }

  describe(): unknown[] {
    return [{
      ns: PROMPT_STUDIO_SETTINGS_NAMESPACE,
      value: { components: [...this.components] },
      revision: this.revision,
      autoGenerate: false,
      applies: 'live',
    }]
  }

  async replace(): Promise<void> {
    if (this.crash) throw new Error('internal fault')
    if (this.conflict) {
      throw Object.assign(new Error('settings namespace "prompt-studio" changed since it was read'), {
        code: 'SETTINGS_CONFLICT',
      })
    }
    this.writes += 1
  }
}

async function boot(components: PromptComponent[] = []) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  const settings = new MemorySettings(components)
  ctx.provide('settings', settings as never)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, personaPrefix: 'Persona.' })
  const webServer = new MemoryWebServer()
  ctx.provide('webServer', webServer as never)
  const fiber = ctx.plugin({ name: 'prompt-studio-test', inject: [...inject], Config, apply }, { components })
  await fiber.await()
  await Promise.resolve()
  return { ctx, fiber, webServer, settings }
}

const systemSupplement: PromptComponent = {
  id: 'supplement:system', kind: 'supplement', role: 'system', order: 20, enabled: true, template: 'Configured.',
}

const messageSupplement: PromptComponent = {
  id: 'supplement:message', kind: 'supplement', role: 'user', position: 'anchored', order: 5,
  enabled: true, template: 'Recall the goal.',
}

describe('Prompt Studio Host composition', () => {
  it('applies configured system supplements to the real assembly', async () => {
    const { ctx } = await boot([systemSupplement])
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('Persona.\n\nConfigured.')
  })

  it('delivers message supplements as ordered runtime context, never as synthetic turns', async () => {
    const { ctx } = await boot([messageSupplement])
    const assembly = await ctx.systemPrompt.assemble()
    expect(renderContextSnapshot(assembly)).toContain('Recall the goal.')
    expect(assembly.contexts.map(context => context.name)).toEqual(['prompt-studio:supplement-context:supplement:message'])
  })

  it('replaces a matched native section through an override', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    const components: PromptComponent[] = []
    ctx.provide('settings', new MemorySettings(() => components) as never)
    const systemPrompt = await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, personaPrefix: 'Persona.' })
    void systemPrompt
    const webServer = new MemoryWebServer()
    ctx.provide('webServer', webServer as never)
    components.push({
      id: 'override:deployment:persona-prefix', kind: 'supplement', role: 'system',
      order: 0, enabled: true, template: 'Replacement.', origin: 'deployment:persona-prefix',
    })
    const fiber = ctx.plugin({ name: 'prompt-studio-test', inject: [...inject], Config, apply }, { components })
    await fiber.await()
    const rendered = renderPrompt(await ctx.systemPrompt.assemble())
    expect(rendered).toBe('Replacement.')
    expect(rendered).not.toContain('Persona.')
  })

  it('captures unknown context producers from a real llm/stream request', async () => {
    const { ctx, webServer } = await boot()
    const direct = createUserMessage({ content: [{ type: 'text', text: 'Go' }], source: { kind: 'user' } })
    const workspace = createUserMessage({
      content: [{ type: 'text', text: '<system-reminder>Instructions from: AGENTS.md</system-reminder>' }],
      source: {
        kind: 'workspace-instructions', form: 'instructions', baseline: true,
        changes: [{ action: 'set', scope: '.\u0000AGENTS.md', path: 'AGENTS.md', digest: 'abc' }],
      },
    })
    const future = createMessage({
      role: 'developer',
      content: [{ type: 'text', text: 'Opaque future context' }],
      source: { kind: 'future-catalog', plugin: 'future-plugin', form: 'catalog' },
    })
    ctx.on('llm/stream', () => (async function* () {})())
    const request = {
      provider: 'virtual', model: 'virtual', messages: [direct, workspace, future], sessionId: 'capture-session',
    } as unknown as GenerateOptions
    for await (const _chunk of ctx.llm.stream(request)) { /* exhaust the real waterfall */ }

    const response = await webServer.get('/prompt-studio/state?sessionId=capture-session')
    expect(response.status).toBe(200)
    expect(response.value).toMatchObject({
      sessionId: 'capture-session',
      layout: { messageCount: 3, userAnchor: 0 },
      captured: [
        { producer: 'workspace-instructions', form: 'instructions', order: 1 },
        { producer: 'future-plugin', form: 'catalog', order: 2 },
      ],
    })
  })

  it('reports the plugin-owned settings entry over its own endpoint', async () => {
    const { webServer } = await boot([systemSupplement])
    const response = await webServer.get('/prompt-studio/settings')
    expect(response).toMatchObject({
      status: 200,
      value: { writable: true, revision: 0, value: { components: [systemSupplement] } },
    })
  })

  it('classifies a malformed JSON body as a client error on both write routes', async () => {
    const { webServer, settings } = await boot()
    const settingsWrite = await webServer.request('POST', '/prompt-studio/settings', '{not json')
    expect(settingsWrite).toMatchObject({ status: 400, value: { error: expect.stringContaining('不是合法 JSON') } })
    const resourceWrite = await webServer.request('POST', '/prompt-studio/resource', '{not json')
    expect(resourceWrite.status).toBe(400)
    expect(settings.writes).toBe(0)
  })

  it('reports a stale revision as 409 and an internal fault as 500', async () => {
    const { webServer, settings } = await boot()
    const body = JSON.stringify({ components: [systemSupplement], expectedRevision: 0 })
    settings.conflict = true
    const stale = await webServer.request('POST', '/prompt-studio/settings', body)
    expect(stale.status).toBe(409)
    settings.conflict = false
    settings.crash = true
    const faulted = await webServer.request('POST', '/prompt-studio/settings', body)
    expect(faulted).toMatchObject({ status: 500, value: { error: 'internal fault' } })
    settings.crash = false
    const accepted = await webServer.request('POST', '/prompt-studio/settings', body)
    expect(accepted.status).toBe(200)
    expect(settings.writes).toBe(1)
  })
})
