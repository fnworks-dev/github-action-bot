/**
 * Deep Job Analysis - Extract structured data from job posts
 * Analyzes: project type, tech stack, scope, timeline, budget, red/green flags
 */
import type { JobAnalysis } from '../types.js';
/**
 * Main analysis function - tries AI, falls back to empty
 */
export declare function analyzeJob(title: string, content: string | null): Promise<JobAnalysis>;
