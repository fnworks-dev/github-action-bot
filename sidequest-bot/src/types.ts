// Profession types supported by SideQuest Board
export type Profession =
    | 'developer'
    | 'artist'
    | 'voice-actor'
    | 'video-editor'
    | 'writer'
    | 'audio'
    | 'qa'
    | 'virtual-assistant';

// Job status tracking
export type JobStatus = 'new' | 'processed' | 'archived';

// Raw post from Reddit RSS/API
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

// Profession configuration
export interface ProfessionConfig {
    name: string;
    keywords: string[];
    subreddits: string[];
}

// AI categorization result
export interface CategorizationResult {
    professions: Profession[];
    confidence: number;
}

// Job post stored in database
export interface JobPost {
    id: string;
    source: 'reddit';
    sourceId: string;
    sourceUrl: string;
    title: string;
    content: string | null;
    author: string | null;
    subreddit: string | null;

    // Profession tags (JSON array in DB)
    professions: Profession[];

    // AI analysis
    score: number | null;
    summary: string | null;

    // Tracking
    status: JobStatus;

    // Timestamps
    postedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

// Discord embed (for future use if needed)
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
