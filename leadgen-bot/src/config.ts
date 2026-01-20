// Configuration loaded from environment variables
export const config = {
    // Turso Database
    turso: {
        url: process.env.TURSO_DATABASE_URL || '',
        authToken: process.env.TURSO_AUTH_TOKEN || '',
    },

    // AI (Gemini or GLM fallback)
    ai: {
        geminiKey: process.env.GEMINI_API_KEY || '',
        geminiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        glmKey: process.env.GLM_API_KEY || '',
        // Anthropic-compatible endpoint for GLM Coding Plan
        glmUrl: 'https://api.z.ai/api/anthropic/v1/messages',
    },

    // Discord
    discord: {
        webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
    },

    // Scoring
    minScoreThreshold: parseInt(process.env.MIN_SCORE_THRESHOLD || '6', 10),

    // Reddit subreddits to monitor (focused on hiring intent)
    subreddits: [
        // High intent - people looking for developers
        'startups',
        'cofounder',
        'forhire',
        'freelance_forhire',
        'Entrepreneur',
        'EntrepreneurRideAlong',
        'SaaS',
        'smallbusiness',
        'indiehackers',
        'startup',
        'hwstartups',
        'Startup_Ideas',

        // Non-technical founders (high quality leads)
        'nocode',
        'webdev',
    ],

    // Keywords - INTENT FOCUSED (someone actively looking/hiring)
    keywords: [
        // Direct hiring signals
        'looking for developer',
        'looking for a developer',
        'looking for dev',
        'looking for a dev',

        'need developer',
        'need a developer',
        'need dev',
        'need a dev',

        'hiring developer',
        'hiring a developer',

        'seeking developer',
        'seeking a developer',

        'developer needed',
        'dev needed',
        'developer wanted',

        // Cofounder signals
        'looking for cofounder',
        'looking for co-founder',
        'looking for a cofounder',
        'looking for technical cofounder',
        'seeking cofounder',
        'seeking co-founder',
        'seeking technical cofounder',
        'need cofounder',
        'need a cofounder',
        'need technical cofounder',
        'need a technical co-founder',
        'cofounder wanted',
        'co-founder wanted',
        'CTO cofounder',
        'tech cofounder',

        // Build requests
        'need someone to build',
        'looking for someone to build',
        'help me build my',
        'who can build',

        // Hiring tags
        '[Hiring]',
        '[HIRING]',

        // Freelance/Agency
        'looking for agency',
        'looking for freelancer',
        'need freelancer',
        'hire freelancer',
    ],

    // Posts containing these will be SKIPPED (not shown)
    negativeFilters: [
        // Self-promotion / For Hire posts
        '[For Hire]',
        '[FOR HIRE]',
        'I am a developer',
        "I'm a developer",
        'offering my services',
        'available for hire',
        'my portfolio',
        'hire me',

        // Listicle spam
        'Top 10',
        'Top 5',
        'Best of',
        'Niche ideas',
        'ideas for',

        // Show-off posts
        'just launched',
        'I built',
        'I created',
        'check out my',
        'feedback on my',
        'roast my',
    ],
};

// Validate required config
export function validateConfig(): void {
    const required = [
        ['TURSO_DATABASE_URL', config.turso.url],
        ['TURSO_AUTH_TOKEN', config.turso.authToken],
        ['DISCORD_WEBHOOK_URL', config.discord.webhookUrl],
    ];

    const missing = required.filter(([_, value]) => !value);

    if (!config.ai.geminiKey && !config.ai.glmKey) {
        missing.push(['GEMINI_API_KEY or GLM_API_KEY', '']);
    }

    if (missing.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missing.map(([name]) => name).join(', ')}`
        );
    }
}

// Check if post should be filtered out
export function shouldFilterPost(title: string, content: string): boolean {
    const text = `${title} ${content || ''}`.toLowerCase();

    return config.negativeFilters.some(filter =>
        text.includes(filter.toLowerCase())
    );
}
