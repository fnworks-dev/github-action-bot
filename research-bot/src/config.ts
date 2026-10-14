import 'dotenv/config';

// Configuration loaded from environment variables
const csv = (raw: string) => [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
const GEMINI_KEYS = csv([
    process.env.GEMINI_API_KEYS,
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_BACKUP_KEY_1,
    process.env.GEMINI_BACKUP_KEY_2,
].filter(Boolean).join(','));
export const config = {
    // Turso Database
    turso: {
        url: process.env.TURSO_DATABASE_URL || '',
        authToken: process.env.TURSO_AUTH_TOKEN || '',
    },

    // AI: Gemini key pool x model chain (same rules as sidequest-bot and the app's AI replies).
    ai: {
        // Comma-separated GEMINI_API_KEYS (one per Google project; free limits are per project)
        // plus legacy single-key vars. Rotated per call with key failover.
        geminiKeys: GEMINI_KEYS,
        geminiKey: GEMINI_KEYS[0] || '',
        geminiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
        // All 500 RPD free per project (2026-10-14); gemini-2.0-flash is retired.
        geminiModels: csv(process.env.GEMINI_MODELS || 'gemini-3.1-flash-lite,gemini-3.1-flash-lite-preview,gemini-3.5-flash-lite'),
    },

    // Discord
    discord: {
        webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    },

    // Relevance threshold - only save posts with relevance >= this
    minRelevanceThreshold: parseInt(process.env.MIN_RELEVANCE_THRESHOLD || '4', 10),

    // Batch size for AI calls
    batchSize: 5,

    // Reddit subreddits to monitor - comprehensive business pain coverage
    subreddits: [
        // Primary - small business owners
        'smallbusiness',
        'Entrepreneur',
        'startups',
        'SaaS',
        'ecommerce',

        // E-commerce specific
        'FulfillmentByAmazon',
        'shopify',
        'Etsy',
        'AmazonSeller',

        // Finance/Accounting
        'Bookkeeping',
        'accounting',
        'tax',
        'taxpros',

        // Service businesses
        'AgencyOwner',
        'msp',
        'freelance',
        'consulting',

        // Specific verticals
        'realestate',
        'restaurantowners',
        'HVAC',
        'lawncare',
        'landscaping',

        // Professional services
        'lawfirm',
        'dentistry',

        // Operations
        'supplychain',
        'logistics',

        // Marketing
        'PPC',
        'SEO',
        'marketing',
        'socialmediamarketing',

        // Tech-adjacent
        'nocode',
        'Automate',
        'productivity',
    ],

    // NO keyword filtering - AI decides relevance
    // Only basic spam filters
    negativeFilters: [
        // Self-promotion spam
        '[For Hire]',
        '[FOR HIRE]',
        'check out my',
        'just launched',
        'I built this',
        'try my app',
        'my portfolio',

        // Hiring (not problems)
        '[Hiring]',
        '[HIRING]',

        // Listicle spam
        'Top 10',
        'Top 5',
        'Best of 2',

        // Off-topic
        'AMA',
        'meme',
        'rant without',
    ],
};

// Validate required config
export function validateConfig(): void {
    const required = [
        ['TURSO_DATABASE_URL', config.turso.url],
        ['TURSO_AUTH_TOKEN', config.turso.authToken],
    ];

    const missing = required.filter(([_, value]) => !value);

    if (!config.ai.geminiKeys.length) {
        missing.push(['GEMINI_API_KEYS', '']);
    }

    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.map(([name]) => name).join(', ')}`
        );
    }
}

// Check if post should be filtered out (basic spam only)
export function shouldFilterPost(title: string, content: string): boolean {
    const text = `${title} ${content || ''}`.toLowerCase();

    return config.negativeFilters.some(filter =>
        text.includes(filter.toLowerCase())
    );
}

// Check if this is the daily summary run (00:00 WIB = 17:00 UTC)
export function isDailySummaryTime(): boolean {
    // The workflow runs once a day. GitHub starts its 17:00 UTC cron 1-5 h late, so the old
    // `hour === 17` check almost never matched (last summary sent 2026-08-23). Local runs skip it.
    return ['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME ?? '');
}
