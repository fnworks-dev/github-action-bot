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

// Sidequest run tracking status
export type SidequestRunStatus = 'running' | 'success' | 'failed';

// Execution milestones for workflow observability
export type SidequestRunStage =
    | 'BOOT'
    | 'CONFIG_VALIDATED'
    | 'DB_INITIALIZED'
    | 'RUN_TRACKING_STARTED'
    | 'INITIAL_STATS_LOADED'
    | 'FETCH_STARTED'
    | 'FETCH_COMPLETED'
    | 'PROCESS_COMPLETED'
    | 'CLEANUP_COMPLETED'
    | 'FRESHNESS_VALIDATED'
    | 'RUN_COMPLETED'
    | 'FAILED';

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

// Intent detection result - determines if a post is actually offering work
export interface IntentDetectionResult {
    isJob: boolean;
    confidence: number;
    reason?: string;
    method: 'ai' | 'keyword';
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

// Structured AI analysis of job post
export interface JobAnalysis {
    project_type: string | null;        // e.g., "E-commerce website", "Mobile app"
    tech_stack: string[] | null;        // e.g., ["React", "Node.js", "PostgreSQL"]
    scope: 'small' | 'medium' | 'large' | null;
    timeline_signal: string | null;     // e.g., "ASAP", "2-3 weeks", "flexible"
    budget_signal: string | null;       // e.g., "$5k-$10k", "not mentioned"
    red_flags: string[];                // Warning signs
    green_flags: string[];              // Positive indicators
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
