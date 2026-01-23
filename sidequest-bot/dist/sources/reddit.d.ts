import type { RawPost, Profession } from '../types.js';
export interface EnrichedPost extends RawPost {
    professions: Profession[];
    confidence: number;
    summary: string;
}
/**
 * Fetch all subreddits, filter, and categorize by profession
 */
export declare function fetchRedditPosts(): Promise<EnrichedPost[]>;
/**
 * Fetch posts from a specific profession's subreddits only
 */
export declare function fetchPostsByProfession(professionKey: string): Promise<EnrichedPost[]>;
