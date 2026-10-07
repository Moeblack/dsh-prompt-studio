/** Prompt Studio browser half: one live conversation-view contribution. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import {
  PROMPT_STUDIO_NAMESPACE,
  PROMPT_STUDIO_VIEW_ORDER,
} from '../shared.ts'
import { PromptStudioStore, refreshIfLoaded } from './store.ts'
import {
  PromptStudioSettingsSection,
  PromptStudioView,
  type PromptStudioViewInjected,
} from './PromptStudioView.tsx'

export type { PromptStudioState } from './store.ts'
export type { PromptStudioViewInjected, PromptStudioViewProps } from './PromptStudioView.tsx'

/** Cordis services read by the registrations and the pushed invalidations. */
export const inject = ['slots', 'conversation', 'connection', 'remote']

/** Register the tab, its shared controller, and pushed invalidations. */
export function apply(ctx: ClientContext): void {
  const faces = new Map<string, PromptStudioViewInjected>()
  const faceFor = (sessionId?: string): PromptStudioViewInjected => {
    const key = sessionId ?? ''
    let face = faces.get(key)
    if (face !== undefined) return face
    const controller = new PromptStudioStore(key.length === 0 ? undefined : key)
    face = { controller, hooks: { snapshot: controller.store } }
    faces.set(key, face)
    return face
  }

  ctx.effect(() => {
    const refresh = (): void => {
      for (const { controller } of faces.values()) refreshIfLoaded(controller)
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (namespace) => {
        if (namespace === PROMPT_STUDIO_NAMESPACE) refresh()
      }),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-prompt-studio: pushed invalidations')

  ctx.slots.register({
    name: 'conversation.view',
    id: 'prompt-studio',
    order: PROMPT_STUDIO_VIEW_ORDER,
    label: 'Prompt Studio',
    inject: (sessionId: string) => faceFor(sessionId),
  }, PromptStudioView)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'prompt-studio',
    order: PROMPT_STUDIO_VIEW_ORDER,
    label: 'Prompt Studio',
    inject: () => faceFor(),
  }, PromptStudioSettingsSection))
}
