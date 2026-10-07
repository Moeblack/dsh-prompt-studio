/** Settings namespace shared by the Host registration and browser editor. */
export declare const PROMPT_STUDIO_NAMESPACE = "prompt-studio";
/** Same-origin endpoint exposing the runtime-discovered prompt inventory. */
export declare const PROMPT_STUDIO_STATE_PATH = "/prompt-studio/state";
/** Same-origin endpoint owned by the plugin for its private settings namespace. */
export declare const PROMPT_STUDIO_SETTINGS_PATH = "/prompt-studio/settings";
/** Same-origin endpoint for resources declared by captured context producers. */
export declare const PROMPT_STUDIO_RESOURCE_PATH = "/prompt-studio/resource";
/** Conversation-view placement: Chat is 0 and Trajectory is 10. */
export declare const PROMPT_STUDIO_VIEW_ORDER = 20;
/** Initial order assigned to a newly added supplement. */
export declare const DEFAULT_SUPPLEMENT_ORDER = 100;
/** Namespace reserved for ordered replacement markers owned by the Host half. */
export declare const PROMPT_STUDIO_OVERRIDE_MARKER_PREFIX = "prompt-studio:override-marker:";
/** Runtime provenance is the only component-kind distinction. */
export type PromptComponentKind = 'native' | 'supplement';
/** Message-gap placement used only by user/assistant components. */
export type PromptComponentPosition = 'after_system' | 'anchored' | 'tail';
/** Model-facing role of one component. */
export type PromptComponentRole = 'system' | 'user' | 'assistant';
/** One item in the unified prompt-composition model. */
export interface PromptComponent {
    id: string;
    kind: PromptComponentKind;
    role: PromptComponentRole;
    /** Absent for system components; required for user/assistant components. */
    position?: PromptComponentPosition;
    /** System-section layer or, for messages, order within the selected gap. */
    order: number;
    enabled: boolean;
    template: string;
    /** Native target id when this supplement overrides a runtime component. */
    origin?: string;
    /** Assistant supplements: render as a reasoning or text block. Defaults to text. */
    blockType?: 'text' | 'reasoning';
}
/** Resolved value of the prompt-studio settings namespace. */
export interface StudioConfig {
    components: PromptComponent[];
}
/** Browser-safe snapshot of the plugin-owned settings namespace. */
export interface PromptStudioSettingsSnapshot {
    writable: boolean;
    revision: number;
    value: StudioConfig;
}
/** One source-owned file transition exposed by an instructions-form context. */
export interface CapturedContextResource {
    /** Stable within the captured message. */
    id: string;
    /** Producer-facing path; it remains display metadata until the Host resolves it. */
    path: string;
    action: 'set' | 'replace' | 'remove';
    digest?: string;
    /** True only when the semantic instructions adapter has enough facts to resolve the file. */
    editable: boolean;
}
/** One non-conversation message automatically discovered in an actual model request. */
export interface CapturedPromptComponent {
    id: string;
    kind: 'captured';
    role: PromptComponentRole;
    /** Zero-based position in the unmodified request message sequence. */
    order: number;
    enabled: true;
    /** Human-readable rendering of the exact request blocks. */
    template: string;
    messageId: string;
    sourceKind: string;
    producer: string;
    form?: string;
    summary?: string;
    /** Complete producer metadata, retained for inspection without interpreting unknown kinds. */
    source: Record<string, unknown>;
    resources: CapturedContextResource[];
}
/** Message-layout facts needed to place configured supplements around captured context. */
export interface RuntimeRequestLayout {
    messageCount: number;
    /** Zero-based last true-user message index, or null when the request has none. */
    userAnchor: number | null;
}
/** Runtime state returned by the Host inventory endpoint. */
export interface RuntimePromptCatalog {
    revision: number;
    native: PromptComponent[];
    /** Effective system-section sequence from the latest real assembly. */
    assembled: PromptComponent[];
    /** Session selected by the request query, or the latest captured session. */
    sessionId?: string;
    /** Non-user/plugin-produced request messages from that session's latest actual request. */
    captured: CapturedPromptComponent[];
    layout: RuntimeRequestLayout;
}
/** Exact current bytes of an editable captured file resource. */
export interface CapturedResourceSnapshot {
    path: string;
    content: string;
    digest: string;
}
export type NativeOverride = PromptComponent & {
    kind: 'supplement';
    origin: string;
};
/** Return whether a supplement targets one runtime-native component. */
export declare function isNativeOverride(component: PromptComponent): component is NativeOverride;
/**
 * Validate configured or runtime component rows.
 * @param components - rows to validate.
 * @param allowNative - whether runtime-only native rows are accepted.
 */
export declare function validatePromptComponents(components: readonly PromptComponent[], allowNative?: boolean): void;
/** Render one supplement as plain content without any wrapper markup. */
export declare function renderSupplementBoundary(_id: string, text: string): string;
/** Resolve overrides and supplements for a draft of the single system slot. */
export declare function buildDraftSystemComponents(native: readonly PromptComponent[], configured: readonly PromptComponent[]): PromptComponent[];
/** Concatenate enabled system components using the Host renderer's blank-line rule. */
export declare function renderSystemPreview(components: readonly PromptComponent[]): string;
/** Allocate the first readable supplement id absent from a component draft. */
export declare function nextSupplementId(components: readonly PromptComponent[]): string;
/** Allocate a readable id for a supplement overriding one native component. */
export declare function nextOverrideId(components: readonly PromptComponent[], target: string): string;
