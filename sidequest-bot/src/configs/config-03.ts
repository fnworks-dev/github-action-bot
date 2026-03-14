// Config 03: Audio + QA + General hiring hubs
import type { ProfessionConfig, Profession } from '../types.js';

export const config = {
    turso: {
        url: process.env.TURSO_DATABASE_URL || '',
        authToken: process.env.TURSO_AUTH_TOKEN || '',
    },
    ai: {
        geminiKey: process.env.GEMINI_API_KEY || '',
        geminiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        nvidiaNimKey: process.env.NVIDIA_NIM_API_KEY || '',
        nvidiaNimUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
        nvidiaNimModel: process.env.NVIDIA_NIM_MODEL || 'minimaxai/minimax-m2.5',
    },
    maxPostAgeMs: 24 * 60 * 60 * 1000,
    cleanup: { deleteAfterDays: 30 },
};

export const professions: Record<Profession, ProfessionConfig> = {
    developer: {
        name: 'Developer',
        keywords: [],
        subreddits: [],
    },
    artist: {
        name: 'Artist/Designer',
        keywords: [],
        subreddits: [],
    },
    'voice-actor': {
        name: 'Voice Actor',
        keywords: [],
        subreddits: [],
    },
    'video-editor': {
        name: 'Video Editor',
        keywords: [],
        subreddits: [],
    },
    writer: {
        name: 'Writer',
        keywords: [],
        subreddits: [],
    },
    audio: {
        name: 'Audio/Music',
        keywords: [
            'sound designer', 'audio engineer', 'music composer', 'music producer',
            'sound effects', 'game audio', 'looking for composer', 'need sound designer',
        ],
        subreddits: [
            'forhire',
            'audioengineering',
            'SoundDesign',
            'GameAudio',
            'composers',
            'freelance_forhire',
            'indiegames',
            'WeAreTheMusicMakers',
            'gamedev',
        ],
    },
    qa: {
        name: 'QA/Tester',
        keywords: [
            'qa tester', 'qa engineer', 'quality assurance', 'game tester',
            'beta tester', 'playtester', 'looking for qa', 'need tester',
        ],
        subreddits: [
            'forhire',
            'qa',
            'testing',
            'gameDevClassifieds',
            'freelance_forhire',
            'softwaretesting',
            'gamedev',
        ],
    },
    'virtual-assistant': {
        name: 'Virtual Assistant',
        keywords: [],
        subreddits: [],
    },
};

export const allSubreddits = [
    ...professions.audio.subreddits,
    ...professions.qa.subreddits,
    'gameDevClassifieds',
    'INAT',
    'gamedev',
];

export function validateConfig(): void {
    const required = [
        ['TURSO_DATABASE_URL', config.turso.url],
        ['TURSO_AUTH_TOKEN', config.turso.authToken],
    ];
    const missing = required.filter(([_, value]) => !value);
    if (!config.ai.geminiKey && !config.ai.nvidiaNimKey) {
        missing.push(['GEMINI_API_KEY or NVIDIA_NIM_API_KEY', '']);
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
