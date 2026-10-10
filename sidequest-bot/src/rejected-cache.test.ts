import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadRejected, saveRejected } from './rejected-cache.js';

const DAY = 24 * 60 * 60 * 1000;
const dir = mkdtempSync(join(tmpdir(), 'rejected-cache-'));

test('no file configured or not created yet: empty, and saving is a no-op', () => {
    assert.deepEqual(loadRejected(undefined, DAY), {});
    assert.deepEqual(loadRejected(join(dir, 'missing.json'), DAY), {});
    saveRejected(undefined, { a: 1 });
});

test('round trip keeps fresh rejections and drops ones older than the post window', () => {
    const file = join(dir, 'cache.json');
    const now = 10 * DAY;
    saveRejected(file, { fresh: now - DAY / 2, stale: now - DAY - 1 });
    assert.deepEqual(loadRejected(file, DAY, now), { fresh: now - DAY / 2 });
});

test('a corrupt or hand-edited file does not break the run', () => {
    const file = join(dir, 'broken.json');
    writeFileSync(file, '{not json');
    assert.deepEqual(loadRejected(file, DAY), {});
    writeFileSync(file, JSON.stringify({ ok: Date.now(), bad: 'yesterday' }));
    assert.deepEqual(Object.keys(loadRejected(file, DAY)), ['ok']);
});
