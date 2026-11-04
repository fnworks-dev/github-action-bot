#!/usr/bin/env python3
"""Fetch subreddit listings on the laptop for the SideQuest bots (GitHub runners get blocked by Reddit).

Reddit answers every logged-out client on this machine with 403/429, and since 2026-11-04 every .json listing
even when logged in ("blocked by network security"). Three channels, tried in this order per subreddit:
  browser  the RSS feeds read through the logged-in pi-browser profile "reddit-scraper" (persistent Chromium on an
           invisible Xvfb screen, human input, pacing) by reddit_browser_fetch.mjs, all subreddits up front
  rss      Reddit's public RSS feed, logged out (usually rate limited after one request)
  arctic   the Arctic Shift mirror (what the GitHub bots use)

Usage: reddit_local_fetch.py --out FILE sub [sub ...]
Writes {"generatedAt", "subreddits": {sub: {"channel", "posts"} | {"error"}}, "channels": {name: stats}}.
"""
import argparse, html, json, os, random, re, signal, subprocess, sys, time
import urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime

BROWSER_FETCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reddit_browser_fetch.mjs')
BROWSER_WAIT = 660  # seconds; the fetcher stops itself after 540 (REDDIT_BROWSER_BUDGET_SEC) plus startup
PIDFILE = '/tmp/sqb-reddit-bot.pids'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
ATOM = '{http://www.w3.org/2005/Atom}'
FIELDS = ('id', 'title', 'selftext', 'author', 'permalink', 'url', 'created_utc', 'is_self', 'over_18')


class HttpError(Exception):
    def __init__(self, status, body=''):
        super().__init__(f'HTTP {status}')
        self.status, self.body = status, body or ''

    @property
    def blocked(self):  # Reddit's bot wall, as opposed to a private/banned subreddit
        return self.status == 403 and 'network security' in self.body

    @property
    def subreddit_gone(self):
        return self.status in (403, 404) and not self.blocked


def from_json(d):
    return {k: d.get(k) for k in FIELDS}


def html_to_text(s):
    s = re.sub(r'<br\s*/?>|</p>|</li>|</h\d>|</tr>|</blockquote>', '\n', s)
    s = re.sub(r'<li[^>]*>', '- ', s)
    s = html.unescape(re.sub(r'<[^>]+>', '', s))
    return re.sub(r'\n{3,}', '\n\n', s).strip()


def parse_atom(data):
    posts = []
    for e in ET.fromstring(data).iter(ATOM + 'entry'):
        rid, link = e.findtext(ATOM + 'id') or '', e.find(ATOM + 'link')
        if not rid.startswith('t3_') or link is None:
            continue
        url = link.get('href', '')
        body = re.search(r'<!-- SC_OFF -->(.*?)<!-- SC_ON -->', e.findtext(ATOM + 'content') or '', re.S)
        published = e.findtext(ATOM + 'published') or e.findtext(ATOM + 'updated') or ''
        posts.append({
            'id': rid[3:], 'title': e.findtext(ATOM + 'title') or '',
            'selftext': html_to_text(body.group(1)) if body else '',
            'author': (e.findtext(f'{ATOM}author/{ATOM}name') or '').removeprefix('/u/'),
            'permalink': urllib.parse.urlparse(url).path, 'url': url,
            'created_utc': datetime.fromisoformat(published).timestamp() if published else 0,
            'is_self': bool(body), 'over_18': False,  # RSS has no NSFW flag: mark_nsfw() fills it in from Arctic Shift
        })
    return posts


def http_get(url, timeout, headers):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise HttpError(e.code, e.read().decode('utf-8', 'replace'))  # whole page: the wall's text comes after its CSS


class Channel:
    reddit = True  # requests go to reddit.com, so they share the pacing

    def __init__(self):
        self.ok = self.failed = self.streak = 0
        self.disabled = None


class Rss(Channel):
    name = 'rss'

    def fetch(self, sub):
        return parse_atom(http_get(f'https://www.reddit.com/r/{sub}/new/.rss?limit=100', 25, {'User-Agent': UA}))


class Arctic(Channel):
    name, reddit = 'arctic', False

    def fetch(self, sub):
        url = f'https://arctic-shift.photon-reddit.com/api/posts/search?subreddit={sub}&limit=100'
        data = json.loads(http_get(url, 15, {'User-Agent': 'SidequestBot-local/1.0'}))
        return [from_json(p) for p in data.get('data') or []]


class Browser(Channel):
    """RSS through the logged-in pi-browser profile. reddit_browser_fetch.mjs reads every subreddit up front in one
    paced browser session and stops by itself when Reddit says back off; fetch() only hands out its results."""
    name, reddit = 'browser', False  # the pi-browser profile paces its own requests

    def __init__(self):
        super().__init__()
        self.results, self.stopped = {}, None

    def start(self, subs):
        proc = None
        try:
            proc = subprocess.Popen(['node', '--no-warnings', BROWSER_FETCH, *subs], stdout=subprocess.PIPE, start_new_session=True)
            with open(PIDFILE, 'w') as f:
                f.write(str(proc.pid))
            try:
                out = proc.communicate(timeout=BROWSER_WAIT)[0]
            except subprocess.TimeoutExpired:
                kill_group(proc.pid, signal.SIGTERM)  # it prints what it has, then closes its browser
                out = proc.communicate(timeout=30)[0]
            lines = out.decode('utf-8', 'replace').strip().splitlines()
            if not lines:
                raise RuntimeError(f'reddit_browser_fetch.mjs exited with {proc.returncode} and no result')
            d = json.loads(lines[-1])
            if d.get('disabled'):
                self.disabled = d['disabled']
            else:
                self.results, self.stopped = d['subs'], d.get('stopped')
        except Exception as e:
            self.disabled = f'{type(e).__name__}: {e}'
        finally:
            if proc and proc.poll() is None:
                kill_group(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    pass
            if proc:
                kill_group(proc.pid, signal.SIGKILL)  # whatever a crashed fetcher left behind (Xvfb, Chromium)
            if os.path.exists(PIDFILE):
                os.remove(PIDFILE)

    def fetch(self, sub):
        r = self.results.get(sub)
        if r is None:
            raise RuntimeError(self.stopped or 'not fetched')
        if 'xml' not in r:
            raise HttpError(r['status'], r['error']) if r.get('status') else RuntimeError(r['error'])
        return parse_atom(r['xml'].encode())


def mark_nsfw(results, get=lambda url: http_get(url, 30, {'User-Agent': 'SidequestBot-local/1.0'}), chunk=500):
    """Set over_18 on RSS posts from Arctic Shift, which mirrors new posts within about a minute.
    Fails open (posts stay unflagged; the keyword filters and the AI scorer still apply). Returns a log line."""
    posts = {p['id']: p for r in results.values() if r.get('channel') in ('browser', 'rss') for p in r['posts']}
    ids, known, flagged = list(posts), 0, 0
    for i in range(0, len(ids), chunk):
        try:
            data = json.loads(get('https://arctic-shift.photon-reddit.com/api/posts/ids?fields=id,over_18&ids=' + ','.join(ids[i:i + chunk])))
        except Exception as e:
            return f'nsfw: Arctic Shift failed ({e}) after {known}/{len(ids)} posts, {flagged} flagged; the rest unchecked'
        for d in data.get('data') or []:
            if d.get('id') in posts:
                known += 1
                if d.get('over_18'):
                    posts[d['id']]['over_18'] = True
                    flagged += 1
    return f'nsfw: {flagged} flagged by Arctic Shift ({known}/{len(ids)} posts known)'


def kill_group(pid, sig):
    try:
        os.killpg(pid, sig)
    except (ProcessLookupError, PermissionError):
        pass


def kill_leftovers():
    """A run killed outright can leave its browser fetcher (node, Xvfb, Chromium) behind, holding the profile.
    PIDs get reused, so only kill the recorded process group when one of its processes is provably ours."""
    try:
        pgid = int(open(PIDFILE).read().split()[0])
    except (OSError, ValueError, IndexError):
        return
    for pid in filter(str.isdigit, os.listdir('/proc')):
        try:
            if os.getpgid(int(pid)) == pgid and re.search(rb'reddit_browser_fetch|pi-profiles/reddit-scraper', open(f'/proc/{pid}/cmdline', 'rb').read()):
                return kill_group(pgid, signal.SIGKILL)
        except OSError:
            pass


def fetch_all(subs, channels, pause=lambda: time.sleep(random.uniform(2, 4)), log=print):
    """channels: {'browser', 'rss', 'arctic'} -> Channel, tried in that order. Returns {sub: {'channel', 'posts'} | {'error'}}."""
    results = {}
    for sub in subs:
        errors = []
        for name in ('browser', 'rss', 'arctic'):
            ch = channels[name]
            if ch.disabled:
                continue
            try:
                results[sub] = {'channel': name, 'posts': ch.fetch(sub)}
                ch.ok, ch.streak = ch.ok + 1, 0
                break
            except Exception as e:
                ch.failed += 1
                errors.append(f'{name}: {e}')
                if isinstance(e, HttpError) and e.subreddit_gone:
                    continue  # private/banned subreddit, not a channel problem
                ch.streak += 1
                if isinstance(e, HttpError) and (e.blocked or e.status == 429):
                    # Reddit says back off: stop using this channel for the run (RSS allowed ~13 requests on 2026-10-10)
                    ch.disabled = f'{e} ({"blocked by Reddit" if e.blocked else "rate limited"})'
                elif ch.streak >= 3:
                    ch.disabled = f'{e} (3 failures in a row)'
            finally:
                if ch.reddit:
                    pause()
        if sub in results:
            log(f'   r/{sub}: {len(results[sub]["posts"])} posts via {results[sub]["channel"]}')
        else:
            results[sub] = {'error': '; '.join(errors) or 'every channel is disabled'}
            log(f'   r/{sub}: FAILED ({results[sub]["error"]})')
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('subreddits', nargs='+')
    args = ap.parse_args()
    sys.stdout.reconfigure(line_buffering=True)  # cron log shows progress, and survives a kill by timeout
    subs = sorted({s.lower() for s in args.subreddits})
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))  # cron's timeout: still stop the browser fetcher (finally)
    kill_leftovers()
    browser = Browser()
    browser.start(subs)
    channels = {'browser': browser, 'rss': Rss(), 'arctic': Arctic()}
    if browser.disabled:
        print(f'⚠️  browser channel off: {browser.disabled}')
    results = fetch_all(subs, channels)
    print(mark_nsfw(results))
    stats = {n: {'ok': c.ok, 'failed': c.failed, 'disabled': c.disabled} for n, c in channels.items()}
    ok = sum(1 for r in results.values() if 'posts' in r)
    print(f'📥 {ok}/{len(subs)} subreddits fetched | ' + ' | '.join(f'{n}: {s["ok"]} ok, {s["failed"]} failed' + (f', OFF: {s["disabled"]}' if s['disabled'] else '') for n, s in stats.items()))
    tmp = args.out + '.tmp'
    with open(tmp, 'w') as f:
        json.dump({'generatedAt': time.time(), 'subreddits': results, 'channels': stats}, f)
    os.replace(tmp, args.out)


if __name__ == '__main__':
    sys.exit(main())
