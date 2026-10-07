/** Unified prompt-component editor and request-layout preview. */
import { type ReactNode } from 'react';
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { HostObservable, InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { PromptStudioState, PromptStudioStore } from './store.ts';
/**
 * Registrant business face supplied by the slot registration. The reserved
 * `hooks` compartment carries the bare snapshot source; the renderer binds it
 * to the component's `useSnapshot` selector hook.
 */
export interface PromptStudioViewInjected {
    controller: PromptStudioStore;
    hooks: {
        snapshot: HostObservable<PromptStudioState>;
    };
}
/** Full conversation-view props after the injected face is composed. */
export type PromptStudioViewProps = ConvViewProps & InjectFace<PromptStudioViewInjected>;
/** Settings-page props over the same controller and editor surface. */
export type PromptStudioSettingsSectionProps = PropsRuntime<'settings.section'> & InjectFace<PromptStudioViewInjected>;
/** Conversation-view entry point. */
export declare function PromptStudioView({ controller, useSnapshot, useSession }: PromptStudioViewProps): ReactNode;
/** Settings-page entry point sharing the exact live editor state. */
export declare function PromptStudioSettingsSection({ controller, useSnapshot, }: PromptStudioSettingsSectionProps): ReactNode;
