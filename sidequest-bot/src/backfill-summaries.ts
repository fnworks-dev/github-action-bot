#!/usr/bin/env node
import { validateConfig } from './config.js';
import { initDb, getDb } from './db/turso.js';
import { generateSummary } from './ai/categorizer.js';

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
    if (value == null) return defaultValue;
    return ['1', 'true', 'yes', 'y', 'on'].includes(value.toLowerCase().trim());
}

async function sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
    const since = (process.env.BACKFILL_SINCE || '2026-03-12').trim();
    const limit = Math.max(1, Number.parseInt(process.env.BACKFILL_LIMIT || '200', 10) || 200);
    const dryRun = parseBool(process.env.BACKFILL_DRY_RUN, true);
    const sleepMs = Math.max(0, Number.parseInt(process.env.BACKFILL_SLEEP_MS || '500', 10) || 500);

    console.log('🧩 SideQuest summary backfill starting...');
    console.log(`   since=${since} limit=${limit} dryRun=${dryRun} sleepMs=${sleepMs}`);

    validateConfig();
    await initDb();

    const db = getDb();
    const result = await db.execute({
        sql: `
            SELECT id, title, content, summary, created_at
            FROM job_posts
            WHERE created_at >= ?
              AND content IS NOT NULL
              AND TRIM(content) != ''
              AND (summary IS NULL OR TRIM(summary) = TRIM(title))
            ORDER BY created_at DESC
            LIMIT ?
        `,
        args: [since, limit],
    });

    const rows = result.rows as any[];
    console.log(`   found=${rows.length}`);

    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const id = String(row.id);
        const title = String(row.title || '').trim();
        const content = row.content == null ? null : String(row.content);

        if (!title || !content || !content.trim()) {
            skipped++;
            continue;
        }

        try {
            const summary = (await generateSummary(title, content)).trim();
            const isEcho = summary.toLowerCase() === title.toLowerCase();

            if (!summary || isEcho) {
                skipped++;
                continue;
            }

            if (dryRun) {
                console.log(`   [${i + 1}/${rows.length}] DRY updated id=${id} "${title.slice(0, 60)}..."`);
                updated++;
            } else {
                await db.execute({
                    sql: `UPDATE job_posts SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    args: [summary, id],
                });
                console.log(`   [${i + 1}/${rows.length}] updated id=${id} "${title.slice(0, 60)}..."`);
                updated++;
            }
        } catch (error) {
            console.warn(`   [${i + 1}/${rows.length}] failed id=${id}:`, error);
            skipped++;
        }

        if (sleepMs > 0) {
            await sleep(sleepMs);
        }
    }

    console.log(`✅ Backfill done. updated=${updated} skipped=${skipped}`);
}

main().catch(error => {
    console.error('❌ Backfill fatal error:', error);
    process.exit(1);
});

