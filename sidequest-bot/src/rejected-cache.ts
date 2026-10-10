import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';

/**
 * Reddit post ids the AI already rejected, with the time of rejection. Without it every 2-hourly local run
 * re-scored the same ~50 rejected posts of the last 24 h (2026-10-10: 80% of all AI calls).
 * No file (GitHub backup) means no cache: same behavior as before.
 */
export function loadRejected(file: string | undefined, maxAgeMs: number, now = Date.now()): Record<string, number> {
    if (!file || !existsSync(file)) return {};
    try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, number>;
        return Object.fromEntries(Object.entries(raw).filter(([, t]) => typeof t === 'number' && now - t < maxAgeMs));
    } catch {
        return {}; // a broken cache only costs one round of re-scoring
    }
}

export function saveRejected(file: string | undefined, rejected: Record<string, number>): void {
    if (!file) return;
    writeFileSync(`${file}.tmp`, JSON.stringify(rejected));
    renameSync(`${file}.tmp`, file);
}
