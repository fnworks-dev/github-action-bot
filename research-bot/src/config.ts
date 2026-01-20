import 'dotenv/config';

// Configuration loaded from environment variables
export const config = {
    // Turso Database
    turso: {
        url: process.env.TURSO_DATABASE_URL || '',
        authToken: process.env.TURSO_AUTH_TOKEN || '',
    },

    // AI (GLM via Z.ai proxy, Gemini fallback)
    ai: {
        glmKey: process.env.GLM_API_KEY || '',
        // Anthropic-compatible endpoint for GLM via Z.ai proxy
        glmUrl: 'https://api.z.ai/api/anthropic/v1/messages',
        geminiKey: process.env.GEMINI_API_KEY || '',
        geminiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
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

    if (!config.ai.glmKey && !config.ai.geminiKey) {
        missing.push(['GLM_API_KEY or GEMINI_API_KEY', '']);
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
    const now = new Date();
    const hour = now.getUTCHours();
    // 00:00 WIB = 17:00 UTC (UTC+7)
    return hour === 17;
}
