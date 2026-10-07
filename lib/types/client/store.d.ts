/** Browser controller for the prompt-studio settings and runtime inventory. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import { type CapturedPromptComponent, type CapturedResourceSnapshot, type PromptComponent } from '../shared.ts';
/** Remote state consumed by the conversation view. */
export interface PromptStudioState {
    status: 'idle' | 'loading' | 'ready' | 'error';
    error: string | null;
    writable: boolean;
    revision: number;
    components: readonly PromptComponent[];
    native: readonly PromptComponent[];
    assembled: readonly PromptComponent[];
    captured: readonly CapturedPromptComponent[];
    capturedSessionId: string | null;
    messageCount: number;
    userAnchor: number | null;
    catalogRevision: number;
}
/** One browser-side controller, shared by every session-scoped mount of the view. */
export declare class PromptStudioStore {
    private readonly sessionId?;
    /** Observable remote namespace state consumed by every mounted Prompt Studio view. */
    readonly store: SnapshotStore<PromptStudioState>;
    private generation;
    constructor(sessionId?: string | undefined);
    /** Refetch the namespace descriptor and runtime registry; newest request wins. */
    load(): Promise<void>;
    /** Persist one unified component draft with stale-editor protection. */
    save(components: readonly PromptComponent[], expectedRevision: number): Promise<void>;
    /** Load one raw file selected by a captured instructions-form context. */
    loadResource(componentId: string, resourceId: string): Promise<CapturedResourceSnapshot>;
    /** Write one captured source file; its producer remains responsible for next-step reconciliation. */
    saveResource(componentId: string, resourceId: string, content: string, expectedDigest: string): Promise<CapturedResourceSnapshot>;
    private requireCapturedSession;
    private accept;
}
/** Refresh only after the user has opened the view once. */
export declare function refreshIfLoaded(controller: PromptStudioStore): void;
