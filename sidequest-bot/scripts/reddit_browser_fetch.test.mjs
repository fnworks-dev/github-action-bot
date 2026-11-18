import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, firstPage, page } from './reddit_browser_fetch.mjs';

test('classify tells Reddit walls apart', () => {
  // The wall seen on 2026-11-04: kilobytes of CSS before the sentence.
  assert.equal(classify(`<body class=theme-beta><div><style>${'.x{--a:1rem}'.repeat(500)}</style>You&#39;ve been blocked by network security.`), 'blocked');
  assert.equal(classify('whoa there, pardner! Your request has been blocked due to a network policy.'), 'blocked');
  assert.equal(classify('<html><title>Too Many Requests</title></html>'), 'rate limited');
  assert.equal(classify('<html><body>page not found</body></html>'), 'other');
});

test('the in-page code is valid JavaScript that asks for the right page', () => {
  const code = page(firstPage('a&b'));
  new Function(`return ${code}`); // throws on a syntax error
  assert.match(code, /fetch\("\/svc\/shreddit\/community-more-posts\/new\/\?name=a%26b"/);
});

test('reads each New tab deep enough, keeps what it got, and stops when Reddit says back off', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const here = (f) => fileURLToPath(new URL(f, import.meta.url));
  const subs = ['quiet', 'busy', 'endless', 'short', 'flaky', 'dead', 'broken', 'throws', 'tail429', 'after'];
  const p = spawnSync('node', [here('./reddit_browser_fetch.mjs'), ...subs], {
    env: { ...process.env, PI_BROWSER_CORE: here('./reddit_browser_fetch.fake-core.mjs'), REDDIT_BROWSER_RETRY_MS: '0', REDDIT_BROWSER_GAP_MS: '0' },
  });
  const out = JSON.parse(p.stdout.toString().trim().split('\n').pop());
  const asked = (sub) => (p.stderr.toString().match(new RegExp(`fake GET \\S*name=${sub}\\b`, 'g')) || []).length;
  assert.deepEqual(subs.map(asked), [1, 2, 4, 2, 2, 2, 1, 1, 2, 0]);
  // pages kept (two posts a page): enough to cover 6 h, at most 4, and page 1 of r/tail429 although page 2 got a 429
  assert.deepEqual(['quiet', 'busy', 'endless', 'short', 'flaky', 'tail429'].map((s) => out.subs[s].posts.length / 2), [1, 2, 4, 1, 1, 1]);
  assert.doesNotMatch(p.stderr.toString(), /browser r\/short/); // a listing that ends is no error
  assert.equal(out.subs.dead.status, 502); // after one more try
  assert.deepEqual([out.subs.broken.status, out.subs.throws.status], [0, 0]); // count against the channel
  assert.match(out.subs.broken.error, /HTTP 200 a new layout/);
  assert.match(out.subs.throws.error, /timed out/);
  assert.equal(out.stopped, 'rate limited at r/tail429');
  assert.ok(!('after' in out.subs));
});
