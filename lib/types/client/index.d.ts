/** Prompt Studio browser half: one live conversation-view contribution. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
export type { PromptStudioState } from './store.ts';
export type { PromptStudioViewInjected, PromptStudioViewProps } from './PromptStudioView.tsx';
/** Cordis services read by the registrations and the pushed invalidations. */
export declare const inject: string[];
/** Register the tab, its shared controller, and pushed invalidations. */
export declare function apply(ctx: ClientContext): void;
