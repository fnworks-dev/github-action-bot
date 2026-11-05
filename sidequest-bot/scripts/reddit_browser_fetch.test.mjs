import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './reddit_browser_fetch.mjs';

test('classify tells feeds from Reddit walls', () => {
  assert.equal(classify('<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry/></feed>'), 'feed');
  assert.equal(classify('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), 'feed');
  // The wall seen on 2026-11-04: kilobytes of CSS before the sentence.
  assert.equal(classify(`<body class=theme-beta><div><style>${'.x{--a:1rem}'.repeat(500)}</style>You&#39;ve been blocked by network security.`), 'blocked');
  assert.equal(classify('whoa there, pardner! Your request has been blocked due to a network policy.'), 'blocked');
  assert.equal(classify('<html><title>Too Many Requests</title></html>'), 'rate limited');
  assert.equal(classify('<html><body>page not found</body></html>'), 'other');
  assert.equal(classify('<html><body><pre>&lt;feed&gt;</pre></body></html>'), 'other'); // an HTML page about a feed is not one
});

test('a feed that fails with an empty-body 5xx gets exactly one more try', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const here = (f) => fileURLToPath(new URL(f, import.meta.url));
  const out = execFileSync('node', [here('./reddit_browser_fetch.mjs'), 'ok', 'flaky', 'dead', 'after'], {
    env: { ...process.env, PI_BROWSER_CORE: here('./reddit_browser_fetch.fake-core.mjs'), REDDIT_BROWSER_RETRY_MS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString().trim().split('\n').pop();
  const { subs, stopped } = JSON.parse(out);
  assert.deepEqual(Object.keys(subs).filter((s) => subs[s].xml), ['ok', 'flaky', 'after']);
  assert.match(subs.dead.error, /ERR_HTTP_RESPONSE_CODE_FAILURE/);
  assert.equal(stopped, null);
});
