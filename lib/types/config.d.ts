import z from '@deepseek-ai/schemastery';
import type { Volatile } from '@deepseek-ai/cordis';
import { type PromptComponent } from './shared.ts';
/** Validated plugin Config: only user-authored supplements are stored, as a live field. */
export interface Config {
    components: Volatile<PromptComponent[]>;
}
/**
 * Plugin Config schema. `components` is volatile so the settings service can
 * edit the list in place and the running pipeline re-reads it without
 * remounting the plugin fiber.
 */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    components: z<NoInfer<PromptComponent[]>, NoInfer<PromptComponent[]>, "volatile">;
}>, Schemastery.ObjectT<{
    components: z<NoInfer<PromptComponent[]>, NoInfer<PromptComponent[]>, "volatile">;
}>>;
/** Persisted settings schema. Only user-authored supplements are stored. */
export declare const studioConfigSchema: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<{
    components: z<NoInfer<PromptComponent[]>, NoInfer<PromptComponent[]>, "volatile">;
}>, Schemastery.ObjectT<{
    components: z<NoInfer<PromptComponent[]>, NoInfer<PromptComponent[]>, "volatile">;
}>>;
