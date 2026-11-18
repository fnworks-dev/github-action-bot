// Stand-in for the pi-browser core (PI_BROWSER_CORE) in reddit_browser_fetch.test.mjs: answers each New tab request
// the way the subreddit's name says. Every request is logged to stderr as "fake GET <path>".
const now = Date.now() / 1000;
const asked = {};
const post = (id, hoursAgo) => ({ id, title: 't', selftext: '', author: 'a', permalink: `/comments/${id}/`, url: '',
  created_utc: Math.floor(now - hoursAgo * 3600), is_self: true, over_18: false });
// Page n of two posts, the older one `hours` old, newest first like Reddit.
const listing = (sub, n, hours) => ({ status: 200, body: '', posts: [post(`${sub}${n}a`, hours - 0.5), post(`${sub}${n}b`, hours)],
  more: `/svc/shreddit/community-more-posts/new/?name=${sub}&after=${n}` });
const wall = (status, body = '') => ({ status, posts: [], more: null, body });
const answers = {
  quiet: (n) => listing('quiet', n, 30), // one page covers a day
  busy: (n) => listing('busy', n, n * 4), // 4 h a page: two cover the 6 h
  endless: (n) => listing('endless', n, n * 0.1), // never covered: stops at MAX_PAGES
  short: (n) => (n === 1 ? listing('short', 1, 1) : wall(200, '<html><body></body></html>')), // the listing ends
  flaky: (n, k) => (k === 1 ? wall(502) : listing('flaky', n, 30)),
  dead: () => wall(502),
  broken: () => wall(200, '<html><body>a new layout</body></html>'),
  throws: () => { throw new Error('Runtime.evaluate: timed out'); },
  tail429: (n) => (n === 1 ? listing('tail429', 1, 1) : wall(429, '<html><title>Too Many Requests</title></html>')),
};
export const loadProfiles = () => ({ 'reddit-scraper': {} });
export class Browser {
  cur = {};
  async run() {} // the home page
  async ev(tab, expr) {
    if (expr.includes('expand-user-drawer-button')) return true; // logged in
    const path = JSON.parse(expr.match(/fetch\((".*?")/)[1]);
    const q = new URL(path, 'https://www.reddit.com').searchParams;
    const sub = q.get('name');
    asked[sub] = (asked[sub] || 0) + 1;
    console.error(`fake GET ${path}`);
    return (answers[sub] || ((n) => listing(sub, n, 30)))(Number(q.get('after') || 0) + 1, asked[sub]);
  }
  async shutdown() {}
}
