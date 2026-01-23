// Configuration loaded from environment variables
import type { ProfessionConfig, Profession } from './types.js';

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
        glmUrl: 'https://api.z.ai/api/anthropic/v1/messages',
    },

    // Max post age (24 hours)
    maxPostAgeMs: 24 * 60 * 60 * 1000,

    // Cleanup settings
    cleanup: {
        deleteAfterDays: 30,
    },
};

// Profession definitions with keywords and subreddits
export const professions: Record<Profession, ProfessionConfig> = {
    developer: {
        name: 'Developer',
        keywords: [
            // Direct terms
            'developer', 'programmer', 'software engineer',
            'frontend', 'backend', 'fullstack', 'full stack',
            'web developer', 'web dev', 'app developer',
            'mobile developer', 'ios developer', 'android developer',

            // Tech stack specific
            'react developer', 'vue developer', 'angular developer',
            'nodejs developer', 'python developer', 'java developer',
            'typescript developer', 'javascript developer',
            'php developer', 'laravel developer', 'django developer',

            // Specializations
            'fullstack developer', 'full-stack developer',
            'software engineer', 'software development',
            'ui engineer', 'ux engineer',

            // Hiring patterns
            'looking for developer', 'need developer',
            'hiring developer', 'developer needed',
            'looking for programmer', 'need programmer',
        ],
        subreddits: [
            'forhire',
            'freelance_forhire',
            'webdev',
            'reactjs',
            'javascript',
            'python',
            'coding',
            'learnprogramming',
            'programming',
        ],
    },

    artist: {
        name: 'Artist/Designer',
        keywords: [
            // Direct terms
            'illustrator', 'concept artist', 'graphic designer',
            'ui designer', 'ux designer', 'product designer',
            'logo designer', 'brand designer',

            // Art styles
            'digital artist', 'traditional artist',
            '2d artist', '3d artist',
            'character designer', 'environment artist',

            // Game art
            'game artist', 'sprite artist', 'pixel artist',
            'texture artist', 'asset artist',

            // Hiring patterns
            'looking for artist', 'need artist',
            'hiring artist', 'artist needed',
            'looking for designer', 'need designer',
            'art commission', 'commission artist',
        ],
        subreddits: [
            'forhire',
            'artcommissions',
            'drawforhire',
            'gameDevClassifieds',
            'graphic_design',
            'illustration',
            'UIUCDesign',
        ],
    },

    'voice-actor': {
        name: 'Voice Actor',
        keywords: [
            // Direct terms
            'voice actor', 'voice actress', 'voice talent',
            'voice over', 'voiceover', 'voice artist',
            'va needed', 'voice work',

            // Context specific
            'audiobook narrator', 'audio book narrator',
            'character voice', 'narrator',
            'voice for animation', 'voice for game',

            // Hiring patterns
            'looking for voice actor', 'need voice actor',
            'hiring voice actor', 'voice actor needed',
            'looking for va', 'need va',
            'voice audition', 'voice casting',
        ],
        subreddits: [
            'forhire',
            'VAforhire',
            'VoiceActing',
            'recordthis',
            'audiobookcreation',
        ],
    },

    'video-editor': {
        name: 'Video Editor',
        keywords: [
            // Direct terms
            'video editor', 'video editing',
            'motion graphics', 'motion graphics artist',
            'vfx artist', 'visual effects',

            // Specializations
            'youtube editor', 'content editor',
            'final cut', 'premiere pro', 'after effects',
            'da vinci resolve', 'video production',

            // Related
            'video post production', 'color grading',
            'sound design for video',

            // Hiring patterns
            'looking for video editor', 'need video editor',
            'hiring video editor', 'video editor needed',
            'looking for editor', 'need editor',
        ],
        subreddits: [
            'forhire',
            'VideoEditing',
            'editors',
            'NewTubers',
            'youtube',
            ' filmmakers',
        ],
    },

    writer: {
        name: 'Writer',
        keywords: [
            // Direct terms
            'writer', 'copywriter', 'content writer',
            'technical writer', 'ghostwriter',
            'blog writer', 'article writer',

            // Specializations
            'script writer', 'screenwriter',
            'dialogue writer', 'story writer',
            'game writer', 'narrative designer',

            // Marketing
            'copywriting', 'content creator',
            'seo writer', 'blog post writer',

            // Hiring patterns
            'looking for writer', 'need writer',
            'hiring writer', 'writer needed',
            'looking for copywriter', 'need copywriter',
        ],
        subreddits: [
            'forhire',
            'freelanceWriters',
            'copywriting',
            'writing',
            'screenwriting',
            'gameDevClassifieds',
        ],
    },

    audio: {
        name: 'Audio/Music',
        keywords: [
            // Direct terms
            'sound designer', 'audio engineer',
            'music composer', 'music producer',
            'sound effects', 'sfx',

            // Specializations
            'game audio', 'audio for games',
            'music for video', 'background music',
            ' Foley artist', 'sound mixing',

            // Tools
            'ableton', 'fl studio', 'logic pro',
            'pro tools', 'audio production',

            // Hiring patterns
            'looking for sound designer', 'need sound designer',
            'looking for composer', 'need composer',
            'hiring composer', 'composer needed',
        ],
        subreddits: [
            'forhire',
            'audioengineering',
            'SoundDesign',
            'GameAudio',
            'composers',
            'thisismycomposer',
        ],
    },

    qa: {
        name: 'QA/Tester',
        keywords: [
            // Direct terms
            'qa tester', 'qa engineer', 'quality assurance',
            'game tester', 'beta tester',
            'playtester', 'game testing',

            // Specializations
            'qa testing', 'manual testing',
            'automation testing', 'test case',

            // Hiring patterns
            'looking for qa', 'need qa',
            'looking for tester', 'need tester',
            'hiring qa', 'qa needed',
        ],
        subreddits: [
            'forhire',
            'qa',
            'gameDevClassifieds',
            'testing',
        ],
    },

    'virtual-assistant': {
        name: 'Virtual Assistant',
        keywords: [
            // Direct terms
            'virtual assistant', 'va', 'virtual assistant',
            'personal assistant', 'administrative assistant',

            // Tasks
            'data entry', 'email management',
            'schedule management', 'calendar management',
            'customer support', 'customer service',

            // Skills
            'project management', 'research assistant',
            'social media management', 'admin support',

            // Hiring patterns
            'looking for virtual assistant', 'need virtual assistant',
            'looking for va', 'need va',
            'hiring virtual assistant', 'va needed',
        ],
        subreddits: [
            'forhire',
            'virtualassistant',
            'freelance_forhire',
            'admin',
        ],
    },
};

// Negative filters - posts containing these will be skipped
export const negativeFilters = [
    // Self-promotion / For Hire posts
    '[For Hire]',
    '[FOR HIRE]',
    'I am a',
    "I'm a",
    'I am an',
    "I'm an",
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

    // Non-job posts
    'just launched',
    'I built',
    'I created',
    'check out my',
    'feedback on my',
    'roast my',

    // Surveys and studies
    'survey',
    'study participant',
    'research participant',

    // Simple microtasks (not real jobs)
    'simple tasks',
    'microtasks',

    // Watching content (not jobs)
    'watch basketball',
    'watch videos',
    'like and subscribe',

    // Social media manipulation
    'reddit post',
    'reddit comment',
    'reddit account',
    'upvote',
];

// Get all unique subreddits across all professions
export function getAllSubreddits(): string[] {
    const subredditSet = new Set<string>();
    for (const profession of Object.values(professions)) {
        profession.subreddits.forEach(sub => subredditSet.add(sub));
    }
    return Array.from(subredditSet);
}

// Validate required config
export function validateConfig(): void {
    const required = [
        ['TURSO_DATABASE_URL', config.turso.url],
        ['TURSO_AUTH_TOKEN', config.turso.authToken],
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
    return negativeFilters.some(filter =>
        text.includes(filter.toLowerCase())
    );
}
