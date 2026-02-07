export type Profession = 'developer' | 'artist' | 'voice-actor' | 'video-editor' | 'writer' | 'audio' | 'qa' | 'virtual-assistant';
export type JobStatus = 'new' | 'processed' | 'archived';
export interface RawPost {
    source: 'reddit';
    sourceId: string;
    sourceUrl: string;
    title: string;
    content: string | null;
    author: string | null;
    subreddit: string | null;
    postedAt: string | null;
}
export interface ProfessionConfig {
    name: string;
    keywords: string[];
    subreddits: string[];
}
export interface CategorizationResult {
    professions: Profession[];
    confidence: number;
}
export interface IntentDetectionResult {
    isJob: boolean;
    confidence: number;
    reason?: string;
    method: 'ai' | 'keyword';
}
export interface JobPost {
    id: string;
    source: 'reddit';
    sourceId: string;
    sourceUrl: string;
    title: string;
    content: string | null;
    author: string | null;
    subreddit: string | null;
    professions: Profession[];
    score: number | null;
    summary: string | null;
    status: JobStatus;
    postedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface JobAnalysis {
    project_type: string | null;
    tech_stack: string[] | null;
    scope: 'small' | 'medium' | 'large' | null;
    timeline_signal: string | null;
    budget_signal: string | null;
    red_flags: string[];
    green_flags: string[];
}
export interface DiscordEmbed {
    title: string;
    description: string;
    color: number;
    fields: Array<{
        name: string;
        value: string;
        inline?: boolean;
    }>;
    url?: string;
    timestamp?: string;
}
