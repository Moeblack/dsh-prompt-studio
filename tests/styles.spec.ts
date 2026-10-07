import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/PromptStudioView.module.css', import.meta.url)), 'utf8')
const dshRoot = process.env.DSH_ROOT ?? fileURLToPath(new URL('../../dsh', import.meta.url))
const designPlatform = join(dshRoot, 'packages/client/ui-theme/src/styles/design-platform.css')
const tokens = existsSync(designPlatform) ? readFileSync(designPlatform, 'utf8') : undefined

describe('Prompt Studio theme styles', () => {
  it('never hardcodes a color', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(css).not.toMatch(/\b(?:rgb|hsl)a?\(/i)
  })

  it.skipIf(tokens === undefined)('uses only declared design-platform color tokens', () => {
    const named = [...css.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map(match => match[1])
    const undeclared = [...new Set(named)].filter(name => !tokens?.includes(`  ${String(name)}:`))
    expect(undeclared).toEqual([])
  })
})
