// Subreddit listings through the logged-in pi-browser profile "reddit-scraper": a persistent Chromium on an invisible
// Xvfb screen with human input, real GPU and pacing (see ~/.pi/agent/extensions/browser, profiles.json).
// Reddit blocks .json listings from this laptop since 2026-11-04 ("blocked by network security", even logged in) and
// retired RSS (announced in r/modnews for 2026-11-13, dark here 2026-11-18). So after a normal home page visit this
// asks, from inside the logged-in tab, for what a subreddit's New tab loads as you scroll:
// /svc/shreddit/community-more-posts/new/?name=<sub>, the newest 24 posts as server-rendered <shreddit-post> cards,
// then the next 24 until 6 h are covered (at most 4 pages). About one request per subreddit, like the RSS feeds were;
// ten whole page loads (dozens of requests each) got HTTP 429.
// Image/gallery cards carry no body text: reddit_local_fetch.py fills it in from Arctic Shift.
//   node reddit_browser_fetch.mjs sub [sub ...]
//   stdout {"disabled": reason} | {"subs": {sub: {"posts"} | {"status", "error"}}, "stopped": reason | null}
//   posts have the fields of reddit_local_fetch.FIELDS
// Progress goes to stderr. Called by reddit_local_fetch.py (channel "browser").
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = process.env.PI_BROWSER_CORE || join(homedir(), '.pi/agent/extensions/browser/core.ts');
const PROFILE = process.env.REDDIT_BROWSER_PROFILE || 'reddit-scraper';
const BUDGET_MS = Number(process.env.REDDIT_BROWSER_BUDGET_SEC || 540) * 1000; // reddit_local_fetch.py waits 600 s
const RETRY_MS = Number(process.env.REDDIT_BROWSER_RETRY_MS ?? 5000);
const GAP_MS = Number(process.env.REDDIT_BROWSER_GAP_MS ?? 3000); // 1-2x this between requests, the old RSS pace
// A page is 24 posts, under 3 h on r/blender: read on to cover this much, so a missed 2-hourly run loses nothing.
const COVER_SEC = Number(process.env.REDDIT_BROWSER_COVER_HOURS || 6) * 3600;
const MAX_PAGES = 4; // 96 posts, about what a feed gave
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reddit's walls are HTML pages, so judge the body rather than trusting a status code.
export function classify(body) {
  if (/network (security|policy)/i.test(body)) return 'blocked';
  if (/too many requests/i.test(body)) return 'rate limited';
  return 'other';
}

export const firstPage = (sub) => `/svc/shreddit/community-more-posts/new/?name=${encodeURIComponent(sub)}`;

// In-page code: one page of a New tab as {status, posts in the shape of reddit_local_fetch.FIELDS, more: the next
// page's path or null, body: if there are no posts}.
export const page = (path) => `(async () => {
  const r = await fetch(${JSON.stringify(path)}, { headers: { accept: 'text/html' } });
  const html = await r.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const text = (el) => {
    if (!el) return '';
    el.querySelectorAll('br').forEach((e) => e.replaceWith('\\n'));
    el.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr').forEach((e) => e.append('\\n'));
    return el.textContent.replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  };
  const posts = [...doc.querySelectorAll('shreddit-post[id^="t3_"]')].map((p) => ({
    id: p.id.slice(3), title: p.getAttribute('post-title') || '', selftext: text(p.querySelector('[slot="text-body"]')),
    author: p.getAttribute('author') || '', permalink: p.getAttribute('permalink') || '',
    url: new URL(p.getAttribute('content-href') || p.getAttribute('permalink') || '/', location.origin).href,
    created_utc: Math.floor(Date.parse(p.getAttribute('created-timestamp')) / 1000) || 0,
    is_self: ['text', 'multi_media', 'poll'].includes(p.getAttribute('post-type')), over_18: p.hasAttribute('nsfw'),
  }));
  const more = doc.querySelector('faceplate-partial[src*="more-posts"]')?.getAttribute('src') || null;
  return { status: r.status, posts, more, body: posts.length ? '' : html.slice(0, 200000) };
})()`;

const out = { subs: {}, stopped: null };

async function main(subs) {
  const { Browser, loadProfiles } = await import(CORE);
  const prof = loadProfiles()[PROFILE];
  if (!prof) return { disabled: `pi-browser profile ${PROFILE} not found` };
  const b = new Browser(PROFILE, prof);
  // reddit_local_fetch.py sends SIGTERM when it gives up waiting: hand over what we have and close the browser.
  process.once('SIGTERM', async () => {
    out.stopped = 'terminated';
    console.log(JSON.stringify(out));
    await b.shutdown().catch(() => {});
    process.exit(143);
  });
  const t0 = Date.now();
  try {
    // Arrive like a person: the home page first. It also shows whether the session is still logged in.
    // One retry: a single slow or interrupted home page must not cost the whole run.
    let user;
    for (let attempt = 1; user === undefined; attempt++) {
      try {
        await b.run('open', { url: 'https://www.reddit.com/' });
        user = await b.ev(b.cur, `!!document.querySelector('#expand-user-drawer-button')`);
      } catch (e) {
        const msg = String(e.message || e);
        if (attempt >= 2 || /hourly limit|quiet hours|refusing to use profile|already open/.test(msg)) return { disabled: `browser: ${msg}` };
        console.error(`   browser: home page failed (${msg.slice(0, 160)}), trying once more`);
      }
    }
    if (!user) {
      const text = await b.ev(b.cur, 'document.body ? document.body.innerText : ""').catch(() => '');
      const r = await b.run('look', { screenshot: true }).catch(() => ({}));
      if (r.image) writeFileSync('/tmp/sqb-reddit-home.png', Buffer.from(r.image, 'base64'));
      return { disabled: classify(text) === 'blocked' ? 'HTTP 403 (blocked by Reddit at the home page)'
        : `not logged in to Reddit (no user menu; screenshot /tmp/sqb-reddit-home.png). Log in with: /browser-login ${PROFILE}` };
    }
    const tab = b.cur;
    // ponytail: Browser.ev is internal API (run('eval') returns text). Revisit if core.ts changes.
    const read = (path) => b.ev(tab, page(path))
      .catch((e) => ({ status: 0, posts: [], more: null, body: '', error: String(e.message || e).slice(0, 200) }));
    for (let i = 0, retried = null; i < subs.length; i++) {
      const sub = subs[i];
      if (Date.now() - t0 > BUDGET_MS) { out.stopped = 'time budget used up'; break; }
      const posts = [], cutoff = Date.now() / 1000 - COVER_SEC;
      let r = { more: firstPage(sub) };
      for (let n = 0; n < MAX_PAGES && r.more && !(posts.length && posts.at(-1).created_utc < cutoff); n++) {
        await sleep(GAP_MS * (1 + Math.random())); // our own pacing: in-page requests bypass the profile's pace rules
        r = await read(r.more);
        posts.push(...r.posts);
        if (!r.posts.length) break;
      }
      if (posts.length) out.subs[sub] = { posts };
      if (r.posts.length || (posts.length && r.status === 200)) continue; // done, or the listing simply ended
      const kind = r.status === 429 ? 'rate limited' : classify(r.body);
      const text = r.body.replace(/<(style|script)[\s\S]*?<\/\1>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const error = r.error || `${kind}: HTTP ${r.status} ${text.slice(0, 160)}`;
      console.error(`   browser r/${sub}${posts.length ? `, page after ${posts.length} posts` : ''}: ${error}`);
      // HTTP 200 without cards means Reddit changed the markup: status 0, so it counts against the channel.
      if (!posts.length) out.subs[sub] = { status: r.status === 200 ? 0 : r.status, error };
      if (kind !== 'other') { out.stopped = `${kind} at r/${sub}`; break; } // Reddit says back off: no more requests this run
      // A 5xx comes and goes per subreddit: one more try.
      if (!posts.length && r.status >= 500 && retried !== sub) { retried = sub; i--; await sleep(RETRY_MS); }
    }
    return out;
  } finally {
    await b.shutdown().catch(() => {});
    console.error(`   browser: ${Object.values(out.subs).filter(s => s.posts).length}/${subs.length} subreddits in ${Math.round((Date.now() - t0) / 1000)} s${out.stopped ? `, stopped: ${out.stopped}` : ''}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await main(process.argv.slice(2)).catch(e => ({ disabled: `browser: ${e.message || e}` }));
  console.log(JSON.stringify(result));
}
