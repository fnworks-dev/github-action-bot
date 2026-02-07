import type { IntentDetectionResult, RawPost } from '../types.js';
/**
 * Detect hiring intent using hybrid approach:
 * 1. Keyword check for obvious patterns
 * 2. AI verification for unclear cases
 */
export declare function detectHiringIntent(title: string, content: string | null): Promise<IntentDetectionResult>;
/**
 * Filter posts array to only those with hiring intent
 */
export declare function filterByHiringIntent(posts: RawPost[]): Promise<RawPost[]>;
