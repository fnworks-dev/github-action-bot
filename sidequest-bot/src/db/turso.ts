import { createClient, type Client, LibsqlError } from '@libsql/client';
import { config } from '../config.js';
import type {
    JobPost,
    RawPost,
    JobStatus,
    Profession,
    SidequestRunStage,
    SidequestRunStatus,
} from '../types.js';

let client: Client | null = null;

// Retry configuration
interface RetryOptions {
    maxAttempts: number;
    delayMs: number;
    operation: string;
}

/**
 * Retry wrapper for database operations with exponential backoff.
 * Retries on SERVER_ERROR from Turso (transient issues).
 */
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: RetryOptions
): Promise<T> {
    const { maxAttempts, delayMs, operation } = options;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error as Error;

            const isRetryable =
                error instanceof LibsqlError &&
                error.code === 'SERVER_ERROR';

            if (attempt === maxAttempts || !isRetryable) {
                console.error(
                    `❌ ${operation} failed after ${attempt} attempt(s):`,
                    error
                );
                throw error;
            }

            console.warn(
                `⚠️ ${operation} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs / 1000}s...`
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    throw lastError!;
}

export function getDb(): Client {
    if (!client) {
        client = createClient({
            url: config.turso.url,
            authToken: config.turso.authToken,
        });
    }
    return client;
}

interface StartSidequestRunInput {
    githubRunId: string | null;
    trigger: string;
    stage: SidequestRunStage;
    latestJobCreatedAtBefore: string | null;
}

interface CompleteSidequestRunSuccessInput {
    fetchedCount: number;
    newJobsCount: number;
    stage: SidequestRunStage;
    latestJobCreatedAtAfter: string | null;
}

// Initialize database schema
export async function initDb(): Promise<void> {
    await retryWithBackoff(
        async () => {
            const db = getDb();

            await db.batch(
                [
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
                ],
                'write'
            );

            console.log('✅ Database initialized');
        },
        {
            maxAttempts: 3,
            delayMs: 60000,
            operation: 'initDb',
        }
    );
}

// Get latest created_at in job_posts
export async function getLatestJobCreatedAt(): Promise<string | null> {
    return retryWithBackoff(
        async () => {
            const db = getDb();
            const result = await db.execute({
                sql: 'SELECT MAX(created_at) AS latest_created_at FROM job_posts',
                args: [],
            });
            return (result.rows[0]?.latest_created_at as string | null) ?? null;
        },
        {
            maxAttempts: 3,
            delayMs: 60000,
            operation: 'getLatestJobCreatedAt',
        }
    );
}

// Create run tracking row and return run ID
export async function startSidequestRun(input: StartSidequestRunInput): Promise<string> {
    return retryWithBackoff(
        async () => {
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
                    'running' satisfies SidequestRunStatus,
                    input.stage,
                    input.latestJobCreatedAtBefore,
                ],
            });

            return runId;
        },
        {
            maxAttempts: 3,
            delayMs: 60000,
            operation: 'startSidequestRun',
        }
    );
}

// Update run stage while processing
export async function updateSidequestRunStage(
    runId: string,
    stage: SidequestRunStage
): Promise<void> {
    await retryWithBackoff(
        async () => {
            const db = getDb();
            await db.execute({
                sql: 'UPDATE sidequest_runs SET stage = ? WHERE id = ?',
                args: [stage, runId],
            });
        },
        {
            maxAttempts: 3,
            delayMs: 60000,
            operation: `updateSidequestRunStage(${stage})`,
        }
    );
}

// Mark run success and persist metrics
export async function completeSidequestRunSuccess(
    runId: string,
    input: CompleteSidequestRunSuccessInput
): Promise<void> {
    await retryWithBackoff(
        async () => {
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
                    'success' satisfies SidequestRunStatus,
                    input.stage,
                    input.fetchedCount,
                    input.newJobsCount,
                    input.latestJobCreatedAtAfter,
                    runId,
                ],
            });
        },
        {
            maxAttempts: 3,
            delayMs: 60000,
            operation: 'completeSidequestRunSuccess',
        }
    );
}

// Mark run failure and store error details
export async function completeSidequestRunFailure(
    runId: string,
    stage: SidequestRunStage,
    errorMessage: string
): Promise<void> {
    await retryWithBackoff(
        async () => {
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
                    'failed' satisfies SidequestRunStatus,
                    stage,
                    errorMessage.slice(0, 2000),
                    runId,
                ],
            });
        },
        {
            maxAttempts: 3,
            delayMs: 60000,
            operation: 'completeSidequestRunFailure',
        }
    );
}

// Check if job post already exists
export async function jobExists(
    source: string,
    sourceId: string
): Promise<boolean> {
    return retryWithBackoff(
        async () => {
            const db = getDb();
            const result = await db.execute({
                sql: 'SELECT 1 FROM job_posts WHERE source = ? AND source_id = ?',
                args: [source, sourceId],
            });
            return result.rows.length > 0;
        },
        {
            maxAttempts: 3,
            delayMs: 180000,
            operation: `jobExists(source="${source}", sourceId="${sourceId}")`,
        }
    );
}

// Insert new job post with AI analysis
export async function insertJob(
    post: RawPost,
    professions: Profession[],
    score: number | null,
    summary: string | null,
    analysis?: {
        project_type: string | null;
        tech_stack: string[] | null;
        scope: string | null;
        timeline_signal: string | null;
        budget_signal: string | null;
        red_flags: string[];
        green_flags: string[];
    }
): Promise<string> {
    return retryWithBackoff(
        async () => {
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
        },
        {
            maxAttempts: 3,
            delayMs: 180000,
            operation: 'insertJob',
        }
    );
}

// Update job status
export async function updateJobStatus(
    id: string,
    status: JobStatus
): Promise<void> {
    await retryWithBackoff(
        async () => {
            const db = getDb();
            await db.execute({
                sql: `
                    UPDATE job_posts
                    SET status = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `,
                args: [status, id],
            });
        },
        {
            maxAttempts: 3,
            delayMs: 180000,
            operation: 'updateJobStatus',
        }
    );
}

// Get all job posts with optional filter
export async function getJobs(status?: JobStatus): Promise<JobPost[]> {
    const db = getDb();
    let sql = 'SELECT * FROM job_posts ORDER BY created_at DESC LIMIT 100';
    let args: string[] = [];

    if (status) {
        sql = 'SELECT * FROM job_posts WHERE status = ? ORDER BY created_at DESC LIMIT 100';
        args = [status];
    }

    const result = await db.execute({ sql, args });

    return result.rows.map((row) => ({
        id: row.id as string,
        source: row.source as JobPost['source'],
        sourceId: row.source_id as string,
        sourceUrl: row.source_url as string,
        title: row.title as string,
        content: row.content as string | null,
        author: row.author as string | null,
        subreddit: row.subreddit as string | null,
        professions: JSON.parse(row.professions as string) as Profession[],
        score: row.score as number | null,
        summary: row.summary as string | null,
        status: row.status as JobStatus,
        postedAt: row.posted_at as string | null,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
    }));
}

// Get jobs by profession
export async function getJobsByProfession(profession: Profession, status?: JobStatus): Promise<JobPost[]> {
    const db = getDb();
    let sql = `
        SELECT * FROM job_posts
        WHERE ',' || professions || ',' LIKE ?
        ORDER BY created_at DESC LIMIT 100
    `;
    let args: string[] = [`%,${profession},%`];

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
        id: row.id as string,
        source: row.source as JobPost['source'],
        sourceId: row.source_id as string,
        sourceUrl: row.source_url as string,
        title: row.title as string,
        content: row.content as string | null,
        author: row.author as string | null,
        subreddit: row.subreddit as string | null,
        professions: JSON.parse(row.professions as string) as Profession[],
        score: row.score as number | null,
        summary: row.summary as string | null,
        status: row.status as JobStatus,
        postedAt: row.posted_at as string | null,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
    }));
}

// Delete old posts (30-day cleanup)
export async function deleteOldPosts(): Promise<number> {
    return retryWithBackoff(
        async () => {
            const db = getDb();
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - config.cleanup.deleteAfterDays);

            // First count the posts to be deleted
            const countResult = await db.execute({
                sql: `SELECT COUNT(*) as count FROM job_posts WHERE created_at < ?`,
                args: [cutoffDate.toISOString()],
            });

            const countToDelete = (countResult.rows[0]?.count as number) || 0;

            // Then delete them
            await db.execute({
                sql: `DELETE FROM job_posts WHERE created_at < ?`,
                args: [cutoffDate.toISOString()],
            });

            console.log(`🗑️ Deleted ${countToDelete} posts older than ${config.cleanup.deleteAfterDays} days`);

            return countToDelete;
        },
        {
            maxAttempts: 3,
            delayMs: 180000,
            operation: 'deleteOldPosts',
        }
    );
}

// Get statistics
export async function getStats(): Promise<{
    total: number;
    byStatus: Record<JobStatus, number>;
    byProfession: Record<Profession, number>;
}> {
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
        sql: 'SELECT professions FROM job_posts',
        args: [],
    });

    const total = (totalResult.rows[0]?.count as number) || 0;

    const byStatus: Record<JobStatus, number> = {
        new: 0,
        processed: 0,
        archived: 0,
    };

    for (const row of statusResult.rows) {
        const status = row.status as JobStatus;
        byStatus[status] = (row.count as number) || 0;
    }

    const byProfession: Record<Profession, number> = {
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
        const professions = JSON.parse(row.professions as string) as Profession[];
        for (const prof of professions) {
            byProfession[prof]++;
        }
    }

    return { total, byStatus, byProfession };
}
