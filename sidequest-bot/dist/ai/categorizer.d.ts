import type { CategorizationResult } from '../types.js';
/**
 * Main categorization function - tries AI first, falls back to keywords
 */
export declare function categorizePost(title: string, content: string | null): Promise<CategorizationResult>;
/**
 * Generate a summary of the job post using AI
 */
export declare function generateSummary(title: string, content: string | null): Promise<string>;
