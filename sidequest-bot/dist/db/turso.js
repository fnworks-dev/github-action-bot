import { createClient, LibsqlError } from '@libsql/client';
import { config } from '../config.js';
let client = null;
/**
 * Retry wrapper for database operations with exponential backoff.
 * Retries on SERVER_ERROR from Turso (transient issues).
 */
async function retryWithBackoff(fn, options) {
    const { maxAttempts, delayMs, operation } = options;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            const isRetryable = error instanceof LibsqlError &&
                error.code === 'SERVER_ERROR';
            if (attempt === maxAttempts || !isRetryable) {
                console.error(`❌ ${operation} failed after ${attempt} attempt(s):`, error);
                throw error;
            }
            console.warn(`⚠️ ${operation} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs / 1000}s...`);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    throw lastError;
}
export function getDb() {
    if (!client) {
        client = createClient({
            url: config.turso.url,
            authToken: config.turso.authToken,
        });
    }
    return client;
}
// Initialize database schema
export async function initDb() {
    await retryWithBackoff(async () => {
        const db = getDb();
        await db.batch([
            `CREATE TABLE IF NOT EXISTS job_posts (
                        id TEXT PRIMARY KEY,
                        source TEXT NOT NULL,
                        source_id TEXT NOT NULL,
                        source_url TEXT NOT NULL,
                        title TEXT NOT NULL,
                        content TEXT,
                        author TEXT,
                        subreddit TEXT,
                        professions TEXT,
                        score INTEGER,
                        summary TEXT,
                        status TEXT DEFAULT 'new',
                        posted_at TEXT,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        -- AI Analysis fields
                        project_type TEXT,
                        tech_stack TEXT,
                        scope TEXT,
                        timeline_signal TEXT,
                        budget_signal TEXT,
                        red_flags TEXT,
                        green_flags TEXT
                    )`,
            `CREATE INDEX IF NOT EXISTS idx_job_posts_source ON job_posts(source, source_id)`,
            `CREATE INDEX IF NOT EXISTS idx_job_posts_status ON job_posts(status)`,
            `CREATE INDEX IF NOT EXISTS idx_job_posts_created ON job_posts(created_at)`,
            `CREATE TABLE IF NOT EXISTS sidequest_runs (
                        id TEXT PRIMARY KEY,
                        github_run_id TEXT,
                        trigger TEXT NOT NULL,
                        status TEXT NOT NULL,
                        stage TEXT NOT NULL,
                        fetched_count INTEGER NOT NULL DEFAULT 0,
                        new_jobs_count INTEGER NOT NULL DEFAULT 0,
                        latest_job_created_at_before TEXT,
                        latest_job_created_at_after TEXT,
                        error_message TEXT,
                        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        finished_at TEXT
                    )`,
            `CREATE INDEX IF NOT EXISTS idx_sidequest_runs_started ON sidequest_runs(started_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_sidequest_runs_status ON sidequest_runs(status)`,
            `CREATE INDEX IF NOT EXISTS idx_sidequest_runs_github_run ON sidequest_runs(github_run_id)`,
        ], 'write');
        console.log('✅ Database initialized');
    }, {
        maxAttempts: 3,
        delayMs: 60000,
        operation: 'initDb',
    });
}
// Get latest created_at in job_posts
export async function getLatestJobCreatedAt() {
    return retryWithBackoff(async () => {
        const db = getDb();
        const result = await db.execute({
            sql: 'SELECT MAX(created_at) AS latest_created_at FROM job_posts',
            args: [],
        });
        return result.rows[0]?.latest_created_at ?? null;
    }, {
        maxAttempts: 3,
        delayMs: 60000,
        operation: 'getLatestJobCreatedAt',
    });
}
// Create run tracking row and return run ID
export async function startSidequestRun(input) {
    return retryWithBackoff(async () => {
        const db = getDb();
        const runId = crypto.randomUUID();
        await db.execute({
            sql: `
                    INSERT INTO sidequest_runs (
                        id,
                        github_run_id,
                        trigger,
                        status,
                        stage,
                        latest_job_created_at_before
                    ) VALUES (?, ?, ?, ?, ?, ?)
                `,
            args: [
                runId,
                input.githubRunId,
                input.trigger,
                'running',
                input.stage,
                input.latestJobCreatedAtBefore,
            ],
        });
        return runId;
    }, {
        maxAttempts: 3,
        delayMs: 60000,
        operation: 'startSidequestRun',
    });
}
// Update run stage while processing
export async function updateSidequestRunStage(runId, stage) {
    await retryWithBackoff(async () => {
        const db = getDb();
        await db.execute({
            sql: 'UPDATE sidequest_runs SET stage = ? WHERE id = ?',
            args: [stage, runId],
        });
    }, {
        maxAttempts: 3,
        delayMs: 60000,
        operation: `updateSidequestRunStage(${stage})`,
    });
}
// Mark run success and persist metrics
export async function completeSidequestRunSuccess(runId, input) {
    await retryWithBackoff(async () => {
        const db = getDb();
        await db.execute({
            sql: `
                    UPDATE sidequest_runs
                    SET
                        status = ?,
                        stage = ?,
                        fetched_count = ?,
                        new_jobs_count = ?,
                        latest_job_created_at_after = ?,
                        finished_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `,
            args: [
                'success',
                input.stage,
                input.fetchedCount,
                input.newJobsCount,
                input.latestJobCreatedAtAfter,
                runId,
            ],
        });
    }, {
        maxAttempts: 3,
        delayMs: 60000,
        operation: 'completeSidequestRunSuccess',
    });
}
// Mark run failure and store error details
export async function completeSidequestRunFailure(runId, stage, errorMessage) {
    await retryWithBackoff(async () => {
        const db = getDb();
        await db.execute({
            sql: `
                    UPDATE sidequest_runs
                    SET
                        status = ?,
                        stage = ?,
                        error_message = ?,
                        finished_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `,
            args: [
                'failed',
                stage,
                errorMessage.slice(0, 2000),
                runId,
            ],
        });
    }, {
        maxAttempts: 3,
        delayMs: 60000,
        operation: 'completeSidequestRunFailure',
    });
}
// Check if job post already exists
export async function jobExists(source, sourceId) {
    return retryWithBackoff(async () => {
        const db = getDb();
        const result = await db.execute({
            sql: 'SELECT 1 FROM job_posts WHERE source = ? AND source_id = ?',
            args: [source, sourceId],
        });
        return result.rows.length > 0;
    }, {
        maxAttempts: 3,
        delayMs: 180000,
        operation: `jobExists(source="${source}", sourceId="${sourceId}")`,
    });
}
// Insert new job post with AI analysis
export async function insertJob(post, professions, score, summary, analysis) {
    return retryWithBackoff(async () => {
        const db = getDb();
        const id = crypto.randomUUID();
        await db.execute({
            sql: `
                    INSERT INTO job_posts (
                        id, source, source_id, source_url, title, content, author, subreddit,
                        professions, score, summary, posted_at,
                        project_type, tech_stack, scope, timeline_signal, budget_signal, red_flags, green_flags
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
            args: [
                id,
                post.source,
                post.sourceId,
                post.sourceUrl,
                post.title,
                post.content,
                post.author,
                post.subreddit || null,
                JSON.stringify(professions),
                score,
                summary,
                post.postedAt,
                // Analysis fields
                analysis?.project_type || null,
                analysis?.tech_stack ? JSON.stringify(analysis.tech_stack) : null,
                analysis?.scope || null,
                analysis?.timeline_signal || null,
                analysis?.budget_signal || null,
                analysis?.red_flags?.length ? JSON.stringify(analysis.red_flags) : null,
                analysis?.green_flags?.length ? JSON.stringify(analysis.green_flags) : null,
            ],
        });
        return id;
    }, {
        maxAttempts: 3,
        delayMs: 180000,
        operation: 'insertJob',
    });
}
// Update job status
export async function updateJobStatus(id, status) {
    await retryWithBackoff(async () => {
        const db = getDb();
        await db.execute({
            sql: `
                    UPDATE job_posts
                    SET status = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `,
            args: [status, id],
        });
    }, {
        maxAttempts: 3,
        delayMs: 180000,
        operation: 'updateJobStatus',
    });
}
// Get all job posts with optional filter
export async function getJobs(status) {
    const db = getDb();
    let sql = 'SELECT * FROM job_posts ORDER BY created_at DESC LIMIT 100';
    let args = [];
    if (status) {
        sql = 'SELECT * FROM job_posts WHERE status = ? ORDER BY created_at DESC LIMIT 100';
        args = [status];
    }
    const result = await db.execute({ sql, args });
    return result.rows.map((row) => ({
        id: row.id,
        source: row.source,
        sourceId: row.source_id,
        sourceUrl: row.source_url,
        title: row.title,
        content: row.content,
        author: row.author,
        subreddit: row.subreddit,
        professions: JSON.parse(row.professions),
        score: row.score,
        summary: row.summary,
        status: row.status,
        postedAt: row.posted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
}
// Get jobs by profession
export async function getJobsByProfession(profession, status) {
    const db = getDb();
    let sql = `
        SELECT * FROM job_posts
        WHERE ',' || professions || ',' LIKE ?
        ORDER BY created_at DESC LIMIT 100
    `;
    let args = [`%,${profession},%`];
    if (status) {
        sql = `
            SELECT * FROM job_posts
            WHERE ',' || professions || ',' LIKE ? AND status = ?
            ORDER BY created_at DESC LIMIT 100
        `;
        args = [`%,${profession},%`, status];
    }
    const result = await db.execute({ sql, args });
    return result.rows.map((row) => ({
        id: row.id,
        source: row.source,
        sourceId: row.source_id,
        sourceUrl: row.source_url,
        title: row.title,
        content: row.content,
        author: row.author,
        subreddit: row.subreddit,
        professions: JSON.parse(row.professions),
        score: row.score,
        summary: row.summary,
        status: row.status,
        postedAt: row.posted_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
}
// Delete old posts (30-day cleanup)
export async function deleteOldPosts() {
    return retryWithBackoff(async () => {
        const db = getDb();
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - config.cleanup.deleteAfterDays);
        // First count the posts to be deleted
        const countResult = await db.execute({
            sql: `SELECT COUNT(*) as count FROM job_posts WHERE created_at < ?`,
            args: [cutoffDate.toISOString()],
        });
        const countToDelete = countResult.rows[0]?.count || 0;
        // Then delete them
        await db.execute({
            sql: `DELETE FROM job_posts WHERE created_at < ?`,
            args: [cutoffDate.toISOString()],
        });
        console.log(`🗑️ Deleted ${countToDelete} posts older than ${config.cleanup.deleteAfterDays} days`);
        return countToDelete;
    }, {
        maxAttempts: 3,
        delayMs: 180000,
        operation: 'deleteOldPosts',
    });
}
// Get statistics
export async function getStats() {
    const db = getDb();
    const totalResult = await db.execute({
        sql: 'SELECT COUNT(*) as count FROM job_posts',
        args: [],
    });
    const statusResult = await db.execute({
        sql: 'SELECT status, COUNT(*) as count FROM job_posts GROUP BY status',
        args: [],
    });
    const professionResult = await db.execute({
        sql: `
            SELECT json_each.value AS profession, COUNT(*) AS count
            FROM job_posts
            JOIN json_each(job_posts.professions)
            WHERE job_posts.professions IS NOT NULL
              AND json_valid(job_posts.professions) = 1
            GROUP BY json_each.value
        `,
        args: [],
    });
    const total = totalResult.rows[0]?.count || 0;
    const byStatus = {
        new: 0,
        processed: 0,
        archived: 0,
    };
    for (const row of statusResult.rows) {
        const status = row.status;
        byStatus[status] = row.count || 0;
    }
    const byProfession = {
        developer: 0,
        artist: 0,
        'voice-actor': 0,
        'video-editor': 0,
        writer: 0,
        audio: 0,
        qa: 0,
        'virtual-assistant': 0,
    };
    for (const row of professionResult.rows) {
        const profession = row.profession;
        if (!profession) {
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(byProfession, profession)) {
            byProfession[profession] = Number(row.count) || 0;
        }
    }
    return { total, byStatus, byProfession };
}
