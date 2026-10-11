import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@libsql/client';
import { OLD_UNUSED_POSTS, retryWithBackoff } from './turso.js';

const opts = { maxAttempts: 3, delayMs: 1, operation: 'test' };

test('a dropped connection is retried', async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
        if (++calls === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        return 'ok';
    }, opts);
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
});

test('native fetch failures (code on error.cause) are retried too', async () => {
    let calls = 0;
    const result = await retryWithBackoff(async () => {
        if (++calls === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
        return 'ok';
    }, opts);
    assert.equal(result, 'ok');
});

test('a real query error is not retried', async () => {
    let calls = 0;
    await assert.rejects(retryWithBackoff(async () => {
        calls++;
        throw new Error('no such column: foo');
    }, opts));
    assert.equal(calls, 1);
});

test('the 30-day cleanup keeps old jobs a user saved or drafted a reply for', async () => {
    const db = createClient({ url: ':memory:' });
    await db.executeMultiple(`
        CREATE TABLE job_posts (id TEXT PRIMARY KEY, created_at TEXT);
        CREATE TABLE user_saved_jobs (job_post_id TEXT);
        CREATE TABLE reply_cache (job_post_id TEXT);
        INSERT INTO job_posts VALUES ('old', '2026-01-01 00:00:00'), ('old-saved', '2026-01-01 00:00:00'),
            ('old-replied', '2026-01-01 00:00:00'), ('new', '2026-12-01 00:00:00');
        INSERT INTO user_saved_jobs VALUES ('old-saved'), (NULL);
        INSERT INTO reply_cache VALUES ('old-replied');
    `);
    await db.execute({ sql: `DELETE FROM job_posts WHERE ${OLD_UNUSED_POSTS}`, args: ['2026-06-01T00:00:00.000Z'] });
    const left = (await db.execute('SELECT id FROM job_posts ORDER BY id')).rows.map((r) => r.id);
    assert.deepEqual(left, ['new', 'old-replied', 'old-saved']);
});
