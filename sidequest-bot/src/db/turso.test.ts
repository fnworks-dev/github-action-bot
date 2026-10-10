import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retryWithBackoff } from './turso.js';

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

test('a real query error is not retried', async () => {
    let calls = 0;
    await assert.rejects(retryWithBackoff(async () => {
        calls++;
        throw new Error('no such column: foo');
    }, opts));
    assert.equal(calls, 1);
});
