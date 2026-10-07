import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import {
  validatePromptComponents,
  type PromptComponent,
  type PromptComponentKind,
  type PromptComponentPosition,
  type PromptComponentRole,
} from './shared.ts'

const finiteOrder = z.transform(z.number(), (value) => {
  if (!Number.isFinite(value)) throw new TypeError('prompt component order must be a finite number')
  return value
}, true)

const kindSchema = z.union([
  z.const('native'),
  z.const('supplement'),
]) as z<PromptComponentKind>

const positionSchema = z.union([
  z.const('after_system'),
  z.const('anchored'),
  z.const('tail'),
]) as z<PromptComponentPosition>

const roleSchema = z.union([
  z.const('system'),
  z.const('user'),
  z.const('assistant'),
]) as z<PromptComponentRole>

const blockTypeSchema = z.union([
  z.const('text'),
  z.const('reasoning'),
])

const componentSchema: z<PromptComponent> = z.object({
  id: z.string().min(1),
  kind: kindSchema,
  role: roleSchema,
  position: positionSchema.default(undefined as unknown as PromptComponentPosition),
  order: finiteOrder,
  enabled: z.boolean().default(true),
  template: z.string(),
  origin: z.string().min(1).default(undefined as unknown as string),
  blockType: blockTypeSchema.default(undefined as unknown as 'text' | 'reasoning'),
})

const uniqueComponents = z.transform(z.array(componentSchema), (components) => {
  const normalized = components.map((component) => {
    if (component.role !== 'system') return component
    if (component.position !== undefined && component.position !== 'after_system') return component
    const snapshot = { ...component }
    delete snapshot.position
    return snapshot
  })
  validatePromptComponents(normalized)
  return normalized
}, true)

/** Validated plugin Config: only user-authored supplements are stored, as a live field. */
export interface Config {
  components: Volatile<PromptComponent[]>
}

/**
 * Plugin Config schema. `components` is volatile so the settings service can
 * edit the list in place and the running pipeline re-reads it without
 * remounting the plugin fiber.
 */
export const Config = z.object({
  components: uniqueComponents.default([]).volatile(),
})

/** Persisted settings schema. Only user-authored supplements are stored. */
export const studioConfigSchema = Config

