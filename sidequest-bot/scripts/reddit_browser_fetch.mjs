// Subreddit listings through the logged-in pi-browser profile "reddit-scraper": a persistent Chromium on an invisible
// Xvfb screen with human input, real GPU and pacing (see ~/.pi/agent/extensions/browser, profiles.json).
// Since 2026-11-04 Reddit answers every .json listing from this laptop with "blocked by network security", even
// logged in. The logged-in RSS feed still works and carries 100 posts with full text (image/gallery bodies too).
//   node reddit_browser_fetch.mjs sub [sub ...]
//   stdout {"disabled": reason} | {"subs": {sub: {"xml"} | {"status", "error"}}, "stopped": reason | null}
// Progress goes to stderr. Called by reddit_local_fetch.py (channel "browser").
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = process.env.PI_BROWSER_CORE || join(homedir(), '.pi/agent/extensions/browser/core.ts');
const PROFILE = process.env.REDDIT_BROWSER_PROFILE || 'reddit-scraper';
const BUDGET_MS = Number(process.env.REDDIT_BROWSER_BUDGET_SEC || 540) * 1000; // reddit_local_fetch.py waits 600 s

// Reddit's walls are HTML pages, so judge the body rather than trusting a status code.
export function classify(body) {
  if (/^\s*(<\?xml[^>]*\?>\s*)?<feed[\s>]/.test(body)) return 'feed';
  if (/network (security|policy)/i.test(body)) return 'blocked';
  if (/too many requests/i.test(body)) return 'rate limited';
  return 'other';
}

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
    for (let i = 0, retried = null; i < subs.length; i++) {
      const sub = subs[i];
      if (Date.now() - t0 > BUDGET_MS) { out.stopped = 'time budget used up'; break; }
      try {
        const url = `https://www.reddit.com/r/${sub}/new/.rss?limit=100`;
        await b.run('open', { url });
        const tab = b.cur;
        // ponytail: Browser.cdp/ev are internal API (run('cdp') caps output at 20 kB). Revisit if core.ts changes.
        const r = await b.cdp.send('Page.getResourceContent', { frameId: tab.frameId, url: tab.url || url }, tab.sid);
        const body = r.base64Encoded ? Buffer.from(r.content, 'base64').toString('utf8') : r.content;
        const kind = classify(body);
        if (kind === 'feed') { out.subs[sub] = { xml: body }; continue; }
        const status = await b.ev(tab, `performance.getEntriesByType('navigation')[0]?.responseStatus || 0`).catch(() => 0);
        const text = await b.ev(tab, 'document.body ? document.body.innerText : ""').catch(() => '');
        out.subs[sub] = { status, error: `${kind}: ${text.replace(/\s+/g, ' ').slice(0, 160)}` };
        console.error(`   browser r/${sub}: HTTP ${status} ${out.subs[sub].error}`);
        if (kind !== 'other') { out.stopped = `${kind} at r/${sub}`; break; } // Reddit says back off: no more requests this run
      } catch (e) {
        const msg = String(e.message || e);
        out.subs[sub] = { status: 0, error: msg.slice(0, 200) };
        console.error(`   browser r/${sub}: ${msg.slice(0, 200)}`);
        if (/hourly limit|quiet hours|pace gap|refusing to use profile|already open/.test(msg)) { out.stopped = msg; break; }
        // An empty-body 5xx (ERR_HTTP_RESPONSE_CODE_FAILURE) comes and goes per feed: one more try, like the home page.
        if (retried !== sub && /ERR_HTTP_RESPONSE_CODE_FAILURE/.test(msg)) { retried = sub; i--; await new Promise(r => setTimeout(r, 5000)); continue; }
      }
    }
    return out;
  } finally {
    await b.shutdown().catch(() => {});
    console.error(`   browser: ${Object.values(out.subs).filter(s => s.xml).length}/${subs.length} feeds in ${Math.round((Date.now() - t0) / 1000)} s${out.stopped ? `, stopped: ${out.stopped}` : ''}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await main(process.argv.slice(2)).catch(e => ({ disabled: `browser: ${e.message || e}` }));
  console.log(JSON.stringify(result));
}
