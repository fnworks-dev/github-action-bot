// Config 02: Voice Actor + Video Editor + Writer
import type { ProfessionConfig, Profession } from '../types.js';

export const config = {
    turso: {
        url: process.env.TURSO_DATABASE_URL || '',
        authToken: process.env.TURSO_AUTH_TOKEN || '',
    },
    ai: {
        geminiKey: process.env.GEMINI_API_KEY || '',
        geminiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        nvidiaNimKey: process.env.NIM_API_KEY || process.env.NVIDIA_NIM_API_KEY || process.env.NVIDIA_API_KEY || '',
        nvidiaNimUrl: (process.env.NIM_BASE_URL || process.env.NVIDIA_NIM_URL || 'https://integrate.api.nvidia.com/v1')
            .trim()
            .replace(/\/+$/, '')
            .includes('/chat/completions')
            ? (process.env.NIM_BASE_URL || process.env.NVIDIA_NIM_URL || 'https://integrate.api.nvidia.com/v1')
                .trim()
                .replace(/\/+$/, '')
            : `${(process.env.NIM_BASE_URL || process.env.NVIDIA_NIM_URL || 'https://integrate.api.nvidia.com/v1')
                .trim()
                .replace(/\/+$/, '')}/chat/completions`,
        nvidiaNimModel: process.env.NIM_MODEL || process.env.NVIDIA_NIM_MODEL || 'meta/llama-3.1-8b-instruct',
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
        keywords: [
            'voice actor', 'voice actress', 'voice talent', 'voice over', 'voiceover',
            'narrator', 'voice work', 'looking for voice actor', 'need voice actor',
        ],
        subreddits: [
            'forhire',
            'VAforhire',
            'VoiceActing',
            'recordthis',
            'freelance_forhire',
            'gameDevClassifieds',
            'indiegames',
            'gamedev',
        ],
    },
    'video-editor': {
        name: 'Video Editor',
        keywords: [
            'video editor', 'video editing', 'motion graphics', 'youtube editor',
            'looking for video editor', 'need video editor',
        ],
        subreddits: [
            'forhire',
            'VideoEditing',
            'editors',
            'freelance_forhire',
            'creatorservices',
            'youtubers',
            'ContentCreators',
            'Premiere',
            'AfterEffects',
        ],
    },
    writer: {
        name: 'Writer',
        keywords: [
            'writer', 'copywriter', 'content writer', 'technical writer',
            'ghostwriter', 'script writer', 'looking for writer', 'need writer',
        ],
        subreddits: [
            'forhire',
            'freelanceWriters',
            'copywriting',
            'freelance_forhire',
            'freelance',
            'selfpublish',
            'marketing',
        ],
    },
    audio: {
        name: 'Audio/Music',
        keywords: [],
        subreddits: [],
    },
    qa: {
        name: 'QA/Tester',
        keywords: [],
        subreddits: [],
    },
    'virtual-assistant': {
        name: 'Virtual Assistant',
        keywords: [],
        subreddits: [],
    },
};

export const allSubreddits = [
    ...professions['voice-actor'].subreddits,
    ...professions['video-editor'].subreddits,
    ...professions.writer.subreddits,
];

export function validateConfig(): void {
    const required = [
        ['TURSO_DATABASE_URL', config.turso.url],
        ['TURSO_AUTH_TOKEN', config.turso.authToken],
    ];
    const missing = required.filter(([_, value]) => !value);
    if (!config.ai.geminiKey && !config.ai.nvidiaNimKey) {
        missing.push(['GEMINI_API_KEY or NIM_API_KEY', '']);
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
