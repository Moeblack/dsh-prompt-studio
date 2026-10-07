/** Host half of Prompt Studio: reversible component activation and request-local composition. */
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings';
import { type Config as StudioRuntimeConfig } from './config.ts';
export { DEFAULT_SUPPLEMENT_ORDER, PROMPT_STUDIO_NAMESPACE, PROMPT_STUDIO_RESOURCE_PATH, PROMPT_STUDIO_SETTINGS_PATH, PROMPT_STUDIO_STATE_PATH, PROMPT_STUDIO_VIEW_ORDER, buildDraftSystemComponents, isNativeOverride, nextOverrideId, nextSupplementId, renderSystemPreview, renderSupplementBoundary, validatePromptComponents, } from './shared.ts';
export type { CapturedContextResource, CapturedPromptComponent, CapturedResourceSnapshot, NativeOverride, PromptComponent, PromptComponentKind, PromptComponentPosition, PromptComponentRole, RuntimePromptCatalog, StudioConfig, } from './shared.ts';
export { Config, studioConfigSchema } from './config.ts';
/** Branded Host settings key: the profile entry id declared by `cordis.patch.yml`. */
export declare const PROMPT_STUDIO_SETTINGS_NAMESPACE: SettingsNamespace;
/** Stable Cordis plugin name. */
export declare const name = "client-ui-prompt-studio";
/** Host services required by the component and request pipelines. */
export declare const inject: string[];
/**
 * Register the plugin Config, its live component pipeline, and the routes.
 * @param ctx - the plugin's Host context.
 * @param config - the validated profile-entry Config; `components` is a live reference.
 */
export declare function apply(ctx: Context, config: StudioRuntimeConfig): Promise<void>;
