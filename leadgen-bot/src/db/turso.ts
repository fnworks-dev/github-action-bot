import { createClient, type Client, LibsqlError } from '@libsql/client';
import { config } from '../config.js';
import type { Lead, RawPost, LeadStatus } from '../types.js';

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

            // Check if error is a retryable Turso server error
            const isRetryable =
                error instanceof LibsqlError &&
                error.code === 'SERVER_ERROR';

            // Don't retry if: max attempts reached or error is not retryable
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

// Initialize database schema
export async function initDb(): Promise<void> {
    await retryWithBackoff(
        async () => {
            const db = getDb();

            // Use batch to create table and indexes
            await db.batch(
                [
                    `CREATE TABLE IF NOT EXISTS leads (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_id TEXT NOT NULL,
          source_url TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT,
          author TEXT,
          subreddit TEXT,
          score INTEGER,
          summary TEXT,
          suggested_reply TEXT,
          status TEXT DEFAULT 'new',
          notes TEXT,
          posted_at TEXT,
          notified_at TEXT,
          contacted_at TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`,
                    `CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source, source_id)`,
                    `CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`,
                    `CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at)`,
                ],
                'write'
            );

            console.log('✅ Database initialized');
        },
        {
            maxAttempts: 3,
            delayMs: 60000, // 1 minute (shorter for init)
            operation: 'initDb',
        }
    );
}

// Check if lead already exists
export async function leadExists(
    source: string,
    sourceId: string
): Promise<boolean> {
    return retryWithBackoff(
        async () => {
            const db = getDb();
            const result = await db.execute({
                sql: 'SELECT 1 FROM leads WHERE source = ? AND source_id = ?',
                args: [source, sourceId],
            });
            return result.rows.length > 0;
        },
        {
            maxAttempts: 3,
            delayMs: 180000, // 3 minutes
            operation: `leadExists(source="${source}", sourceId="${sourceId}")`,
        }
    );
}

// Insert new lead
export async function insertLead(
    post: RawPost,
    score: number | null,
    summary: string | null,
    suggestedReply: string | null
): Promise<string> {
    return retryWithBackoff(
        async () => {
            const db = getDb();
            const id = crypto.randomUUID();

            await db.execute({
                sql: `
      INSERT INTO leads (
        id, source, source_id, source_url, title, content, author, subreddit,
        score, summary, suggested_reply, posted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    score,
                    summary,
                    suggestedReply,
                    post.postedAt,
                ],
            });

            return id;
        },
        {
            maxAttempts: 3,
            delayMs: 180000, // 3 minutes
            operation: 'insertLead',
        }
    );
}

// Mark lead as notified
export async function markNotified(id: string): Promise<void> {
    await retryWithBackoff(
        async () => {
            const db = getDb();
            await db.execute({
                sql: `
      UPDATE leads
      SET status = 'notified', notified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
                args: [id],
            });
        },
        {
            maxAttempts: 3,
            delayMs: 180000, // 3 minutes
            operation: 'markNotified',
        }
    );
}

// Update lead status
export async function updateLeadStatus(
    id: string,
    status: LeadStatus
): Promise<void> {
    await retryWithBackoff(
        async () => {
            const db = getDb();
            await db.execute({
                sql: `
      UPDATE leads
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
                args: [status, id],
            });
        },
        {
            maxAttempts: 3,
            delayMs: 180000, // 3 minutes
            operation: 'updateLeadStatus',
        }
    );
}

// Get all leads with optional filter
export async function getLeads(status?: LeadStatus): Promise<Lead[]> {
    const db = getDb();
    let sql = 'SELECT * FROM leads ORDER BY created_at DESC LIMIT 100';
    let args: string[] = [];

    if (status) {
        sql =
            'SELECT * FROM leads WHERE status = ? ORDER BY created_at DESC LIMIT 100';
        args = [status];
    }

    const result = await db.execute({ sql, args });

    return result.rows.map((row) => ({
        id: row.id as string,
        source: row.source as Lead['source'],
        sourceId: row.source_id as string,
        sourceUrl: row.source_url as string,
        title: row.title as string,
        content: row.content as string | null,
        author: row.author as string | null,
        subreddit: row.subreddit as string | null,
        score: row.score as number | null,
        summary: row.summary as string | null,
        suggestedReply: row.suggested_reply as string | null,
        status: row.status as LeadStatus,
        notes: row.notes as string | null,
        postedAt: row.posted_at as string | null,
        notifiedAt: row.notified_at as string | null,
        contactedAt: row.contacted_at as string | null,
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
    }));
}
