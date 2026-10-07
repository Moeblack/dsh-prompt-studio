import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const rootUrl = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', rootUrl)), 'utf8')) as {
  name: string
  main: string
  types: string
  exports: Record<string, { types?: string; default?: string } | string>
  dsh: { bundle: { patch: string }; client: { platform: string; inject?: string[]; external?: string[] } }
  peerDependencies: Record<string, string>
}
const nodeBundle = readFileSync(fileURLToPath(new URL('index.mjs', rootUrl)), 'utf8')
const clientBundle = readFileSync(fileURLToPath(new URL('client.js', rootUrl)), 'utf8')

/** Module-table specifiers the shell seeds before any dynamic plugin row runs. */
const PLATFORM_MODULES = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** Every `require("<specifier>")` the emitted factory resolves through the module table. */
function requiredSpecifiers(code: string): string[] {
  return [...new Set([...code.matchAll(/\brequire\("([^"]+)"\)/g)].map(match => match[1] as string))]
}

describe('bundle distribution artifacts', () => {
  it('declares the bundle patch, types, and web client face under the dsh key', () => {
    expect(manifest).toMatchObject({
      name: 'dsh-prompt-studio',
      main: './index.mjs',
      types: './lib/types/index.d.ts',
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        client: { platform: 'web' },
      },
    })
    expect(manifest.exports['./client']).toEqual({
      types: './lib/types/client/index.d.ts',
      default: './client.js',
    })
    // Package-name dependency edges are informational; this plugin requests no
    // non-baseline module row and no package-specific external.
    expect(manifest.dsh.client.inject ?? []).toEqual([])
    expect(manifest.dsh.client.external ?? []).toEqual([])
    expect(manifest.peerDependencies).toHaveProperty('@deepseek-ai/cordis')
    expect(clientBundle).toContain('window.__ModuleLoader__.load')
    expect(clientBundle).toContain('id: "dsh-prompt-studio"')
  })

  it('requests only shell-seeded module-table rows and never the retired platform packages', () => {
    const required = requiredSpecifiers(clientBundle)
    expect(required.length).toBeGreaterThan(0)
    expect(required.filter(specifier => !PLATFORM_MODULES.has(specifier))).toEqual([])
    expect(clientBundle).not.toContain('@deepseek-ai/dsh-client-web-react')
    expect(clientBundle).not.toContain('@deepseek-ai/dsh-client-runtime')
  })

  it('materializes under a simulated module table and registers its slots', () => {
    const require = createRequire(import.meta.url)
    const table: Record<string, unknown> = {
      react: require('react'),
      'react/jsx-runtime': require('react/jsx-runtime'),
      '@deepseek-ai/dsh-client-store': require('@deepseek-ai/dsh-client-store'),
    }
    const registered: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const injections: Array<{ name: string; run: () => unknown }> = []
    const disposers: Array<() => void> = []
    const listeners = new Map<string, (...args: never[]) => void>()
    const fakeCtx = {
      effect: (run: () => (() => void) | void) => {
        const dispose = run()
        disposers.push(typeof dispose === 'function' ? dispose : () => undefined)
        return () => undefined
      },
      on: (name: string, handler: (...args: never[]) => void) => {
        listeners.set(name, handler)
        return () => { listeners.delete(name) }
      },
      remote: { $on: (name: string, handler: (...args: never[]) => void) => {
        listeners.set(name, handler)
        return () => { listeners.delete(name) }
      } },
      slots: {
        register: (options: Record<string, unknown>, component: unknown) => {
          registered.push({ options, component })
          return () => undefined
        },
        inject: (name: string, run: () => unknown) => {
          injections.push({ name, run })
          return () => undefined
        },
      },
    }
    let registration: { id: string; factory: (require: (specifier: string) => unknown) => Record<string, unknown> } | undefined
    const sandbox = {
      window: {
        __ModuleLoader__: {
          load: (value: typeof registration) => { registration = value },
        },
      },
    }
    vm.runInNewContext(clientBundle, sandbox)
    expect(registration?.id).toBe('dsh-prompt-studio')
    const exports = registration?.factory(specifier => {
      if (!(specifier in table)) throw new Error(`missed the module table: ${specifier}`)
      return table[specifier]
    })
    expect(typeof exports?.apply).toBe('function')
    expect(exports?.inject).toEqual(['slots', 'conversation', 'connection', 'remote'])

    ;(exports?.apply as (ctx: unknown) => void)(fakeCtx)
    expect(registered.map(entry => entry.options.name)).toEqual(['conversation.view'])
    expect(registered[0]?.options).toMatchObject({ id: 'prompt-studio', label: 'Prompt Studio' })
    expect(injections.map(entry => entry.name)).toEqual(['settings.section'])
    injections[0]?.run()
    expect(registered.map(entry => entry.options.name)).toEqual(['conversation.view', 'settings.section'])
    expect(registered[1]?.options).toMatchObject({ id: 'prompt-studio', label: 'Prompt Studio' })

    const face = (registered[0]?.options.inject as (sessionId: string) => {
      controller: { store: unknown }
      hooks: { snapshot: unknown }
    })('session-a')
    expect(face.hooks.snapshot).toBe(face.controller.store)
  })

  it('exports the Cordis Node-half surface self-contained', () => {
    expect(nodeBundle).toMatch(/export \{[^}]*apply/)
    expect(nodeBundle).toMatch(/export \{[^}]*inject/)
    expect(nodeBundle).toMatch(/export \{[^}]*Config/)
    expect(nodeBundle).not.toMatch(/from ["']@deepseek-ai\//)
  })
})
