import type { ProfessionConfig, Profession } from './types.js';
export declare const config: {
    turso: {
        url: string;
        authToken: string;
    };
    ai: {
        geminiKey: string;
        geminiUrl: string;
        glmKey: string;
        glmUrl: string;
    };
    maxPostAgeMs: number;
    cleanup: {
        deleteAfterDays: number;
    };
};
export declare const professions: Record<Profession, ProfessionConfig>;
export declare const negativeFilters: string[];
export declare function getAllSubreddits(): string[];
export declare function validateConfig(): void;
export declare function shouldFilterPost(title: string, content: string): boolean;
