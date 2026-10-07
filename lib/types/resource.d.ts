import type { CapturedContextResource, CapturedResourceSnapshot } from './shared.ts';
export declare class CapturedResourceNotFoundError extends Error {
}
export declare class CapturedResourceConflictError extends Error {
}
/** Load the exact current file selected by one captured instructions transition. */
export declare function loadCapturedResource(cwd: string, resource: CapturedContextResource): Promise<CapturedResourceSnapshot>;
/** Replace the source file only if it still has the bytes loaded by the editor. */
export declare function saveCapturedResource(cwd: string, resource: CapturedContextResource, content: string, expectedDigest: string): Promise<CapturedResourceSnapshot>;
