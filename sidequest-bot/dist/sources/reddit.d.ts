import type { RawPost, Profession } from '../types.js';
export interface EnrichedPost extends RawPost {
    professions: Profession[];
    confidence: number;
    summary: string;
    analysis?: {
        project_type: string | null;
        tech_stack: string[] | null;
        scope: string | null;
        timeline_signal: string | null;
        budget_signal: string | null;
        red_flags: string[];
        green_flags: string[];
    };
}
/**
 * Fetch all subreddits, filter, and categorize by profession
 */
export declare function fetchRedditPosts(): Promise<EnrichedPost[]>;
/**
 * Fetch posts from a specific profession's subreddits only
 */
export declare function fetchPostsByProfession(professionKey: string): Promise<EnrichedPost[]>;
