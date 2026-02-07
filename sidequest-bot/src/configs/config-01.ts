// Config 01: Developer + Artist (Primary hiring subreddits)
import type { ProfessionConfig, Profession } from '../types.js';

export const config = {
    turso: {
        url: process.env.TURSO_DATABASE_URL || '',
        authToken: process.env.TURSO_AUTH_TOKEN || '',
    },
    ai: {
        geminiKey: process.env.GEMINI_API_KEY || '',
        geminiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        glmKey: process.env.GLM_API_KEY || '',
        glmUrl: 'https://api.z.ai/api/anthropic/v1/messages',
    },
    maxPostAgeMs: 24 * 60 * 60 * 1000,
    cleanup: { deleteAfterDays: 30 },
};

export const professions: Record<Profession, ProfessionConfig> = {
    developer: {
        name: 'Developer',
        keywords: [
            'developer', 'programmer', 'software engineer', 'frontend', 'backend', 'fullstack',
            'web developer', 'web dev', 'app developer', 'mobile developer',
            'react developer', 'vue developer', 'angular developer', 'nodejs developer',
            'python developer', 'typescript developer', 'php developer',
            'looking for developer', 'need developer', 'hiring developer', 'developer needed',
        ],
        subreddits: ['forhire', 'freelance_forhire', 'webdev', 'reactjs', 'javascript', 'python'],
    },
    artist: {
        name: 'Artist/Designer',
        keywords: [
            'illustrator', 'concept artist', 'graphic designer', 'ui designer', 'ux designer',
            'digital artist', '2d artist', '3d artist', 'game artist', 'pixel artist',
            'looking for artist', 'need artist', 'hiring artist', 'art commission',
        ],
        subreddits: ['HungryArtists', 'artcommissions', 'drawforhire', 'forhire', 'freelance_forhire', 'design', 'DesignJobs'],
    },
    'voice-actor': {
        name: 'Voice Actor',
        keywords: ['voice actor', 'voice talent', 'voice over', 'voiceover', 'narrator'],
        subreddits: [],
    },
    'video-editor': {
        name: 'Video Editor',
        keywords: ['video editor', 'video editing', 'motion graphics'],
        subreddits: [],
    },
    writer: {
        name: 'Writer',
        keywords: ['writer', 'copywriter', 'content writer', 'technical writer'],
        subreddits: [],
    },
    audio: {
        name: 'Audio/Music',
        keywords: ['sound designer', 'audio engineer', 'music composer'],
        subreddits: [],
    },
    qa: {
        name: 'QA/Tester',
        keywords: ['qa tester', 'qa engineer', 'game tester'],
        subreddits: [],
    },
    'virtual-assistant': {
        name: 'Virtual Assistant',
        keywords: ['virtual assistant', 'va', 'personal assistant'],
        subreddits: [],
    },
};

export const allSubreddits = [
    ...professions.developer.subreddits,
    ...professions.artist.subreddits,
];

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
        throw new Error(`Missing: ${missing.map(([name]) => name).join(', ')}`);
    }
}

export function shouldFilterPost(title: string, content: string): boolean {
    const text = `${title} ${content || ''}`.toLowerCase();
    const negativeFilters = [
        '[for hire]', 'i am a developer', 'i\'m a developer',
        'hire me', 'my portfolio', 'available for hire',
    ];
    return negativeFilters.some((filter) => text.includes(filter.toLowerCase()));
}

export function getAllSubreddits(): string[] {
    return [...new Set(allSubreddits)];
}
