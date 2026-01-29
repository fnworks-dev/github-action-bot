// Lead from any source
export interface Lead {
    id: string;
    source: 'reddit' | 'hackernews' | 'indiehackers' | 'producthunt' | 'apify' | 'lobstr' | 'x';
    sourceId: string;
    sourceUrl: string;
    title: string;
    content: string | null;
    author: string | null;
    subreddit: string | null;

    // AI analysis
    score: number | null;
    summary: string | null;
    suggestedReply: string | null;

    // Tracking
    status: LeadStatus;
    notes: string | null;

    // Timestamps
    postedAt: string | null;
    notifiedAt: string | null;
    contactedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export type LeadStatus =
    | 'new'
    | 'notified'
    | 'contacted'
    | 'replied'
    | 'converted'
    | 'skipped';

// Raw post from RSS/API
export interface RawPost {
    source: 'reddit' | 'hackernews' | 'indiehackers' | 'producthunt' | 'apify' | 'lobstr' | 'x';
    sourceId: string;
    sourceUrl: string;
    title: string;
    content: string | null;
    author: string | null;
    subreddit?: string | null;
    postedAt: string | null;
}

// AI scoring result
export interface ScoringResult {
    score: number;
    summary: string;
    suggestedReply: string;
    shouldNotify: boolean;
}

// Discord notification payload
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
