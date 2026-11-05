// Stand-in for the pi-browser core (PI_BROWSER_CORE) in reddit_browser_fetch.test.mjs.
// r/flaky fails once with an empty-body 5xx, r/dead always does; every other feed works.
const opens = {};
export const loadProfiles = () => ({ 'reddit-scraper': {} });
export class Browser {
  cur = { frameId: 'f', sid: 's', url: '' };
  cdp = { send: async () => ({ base64Encoded: false, content: '<?xml version="1.0"?><feed></feed>' }) };
  async run(action, { url } = {}) {
    const sub = (url.match(/\/r\/([^/]+)\//) || [])[1];
    opens[sub] = (opens[sub] || 0) + 1;
    if (sub === 'dead' || (sub === 'flaky' && opens[sub] === 1)) throw new Error(`navigation failed: net::ERR_HTTP_RESPONSE_CODE_FAILURE (${sub})`);
    this.cur.url = url;
  }
  async ev() { return true; } // logged in
  async shutdown() {}
}
