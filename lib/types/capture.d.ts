/** Pure classification of actual request messages into Prompt Studio context rows. */
import type { RequestMessage } from '@deepseek-ai/dsh-llm';
import { type CapturedPromptComponent, type RuntimeRequestLayout } from './shared.ts';
/** Whether one request message carries producer-owned context rather than conversation. */
export declare function isInjectedContextMessage(message: RequestMessage): boolean;
/** Capture every producer-owned context message without knowing its plugin kind in advance. */
export declare function captureInjectedMessages(messages: readonly RequestMessage[]): CapturedPromptComponent[];
/** Describe the unmodified request gaps used by supplement placement. */
export declare function requestLayout(messages: readonly RequestMessage[]): RuntimeRequestLayout;
