#!/usr/bin/env python3
"""Fetch subreddit listings on the laptop for the SideQuest bots (GitHub runners get blocked by Reddit).

Reddit answers every logged-out client on this machine with 403/429, since 2026-11-04 every .json listing even when
logged in ("blocked by network security"), and it retired RSS (dark here 2026-11-18). Two channels, tried in this
order per subreddit:
  browser  each subreddit's New tab (the last 6 h, at least 24 posts), read through the logged-in pi-browser
           profile "reddit-scraper" (persistent Chromium on an invisible Xvfb screen, human input) by
           reddit_browser_fetch.mjs, all subreddits up front
  arctic   the Arctic Shift mirror (what the GitHub bots use)

Usage: reddit_local_fetch.py --out FILE sub [sub ...]
Writes {"generatedAt", "subreddits": {sub: {"channel", "posts"} | {"error"}}, "channels": {name: stats}}.
"""
import argparse, json, os, random, re, signal, subprocess, sys, time
import urllib.error, urllib.request

BROWSER_FETCH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reddit_browser_fetch.mjs')
BROWSER_WAIT = 660  # seconds; the fetcher stops itself after 540 (REDDIT_BROWSER_BUDGET_SEC) plus startup
PIDFILE = '/tmp/sqb-reddit-bot.pids'
FIELDS = ('id', 'title', 'selftext', 'author', 'permalink', 'url', 'created_utc', 'is_self', 'over_18')


class HttpError(Exception):
    def __init__(self, status, body='', headers=None):
        super().__init__(f'HTTP {status}')
        self.status, self.body, self.headers = status, body or '', headers or {}

    @property
    def blocked(self):  # Reddit's bot wall, as opposed to a private/banned subreddit
        return self.status == 403 and 'network security' in self.body

    @property
    def subreddit_gone(self):
        return self.status in (403, 404) and not self.blocked


def from_json(d):
    return {k: d.get(k) for k in FIELDS}


def http_get(url, timeout, headers):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise HttpError(e.code, e.read().decode('utf-8', 'replace'), e.headers)  # whole page: the wall's text comes after its CSS


class Channel:
    reddit = True  # requests go to reddit.com, so they share the pacing

    def __init__(self):
        self.ok = self.failed = self.streak = 0
        self.disabled = None


def arctic_get(url, timeout, wait=5):
    """GET from Arctic Shift, trying twice more on what passes: 422 is their server aborting a slow query ("Timeout.
    Maybe slow down a bit"; the maintainer says try again), it cost 0-6 subreddits a run in Nov 2026; a Cloudflare 520
    cost half the arctic fill on 2026-11-19. Also network errors, and 429: the limit is per IP and a minute long, and
    the answer says when it lifts (x-ratelimit-reset, seconds)."""
    for attempt in (1, 2, 3):
        try:
            return http_get(url, timeout, {'User-Agent': 'SidequestBot-local/1.0'})
        except (HttpError, OSError) as e:
            if attempt == 3 or (isinstance(e, HttpError) and e.status < 500 and e.status not in (422, 429)):
                raise
            reset = e.headers.get('x-ratelimit-reset') if isinstance(e, HttpError) and e.status == 429 else None
            time.sleep(min(float(reset) + 1, 30) if reset and reset.replace('.', '', 1).isdigit() else wait * attempt)


class Arctic(Channel):
    name, reddit = 'arctic', False

    def fetch(self, sub):
        data = json.loads(arctic_get(f'https://arctic-shift.photon-reddit.com/api/posts/search?subreddit={sub}&limit=100', 15))
        return [from_json(p) for p in data.get('data') or []]


class Browser(Channel):
    """New tabs through the logged-in pi-browser profile. reddit_browser_fetch.mjs reads every subreddit up front in one
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
            # split('\n'), not splitlines(): post text can hold U+2028 etc., which JSON.stringify leaves raw
            lines = out.decode('utf-8', 'replace').strip().split('\n')
            if not lines[-1]:
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
        if 'posts' not in r:
            raise HttpError(r['status'], r['error']) if r.get('status') else RuntimeError(r['error'])
        return r['posts']


def fill_from_arctic(results, get=lambda url: arctic_get(url, 30), chunk=500):
    """Fill in what the browser's cards lack from Arctic Shift, which mirrors new posts within about a minute: the NSFW
    flag, and the body of image/gallery posts (their cards show only the images; most HungryArtists gigs are those).
    Fails open (posts stay as they are; the keyword filters and the AI scorer still apply). Returns a log line."""
    posts = {p['id']: p for r in results.values() if r.get('channel') == 'browser' for p in r['posts']}
    ids, known, flagged, filled = list(posts), 0, 0, 0
    for i in range(0, len(ids), chunk):
        try:
            data = json.loads(get('https://arctic-shift.photon-reddit.com/api/posts/ids?fields=id,over_18,selftext&ids=' + ','.join(ids[i:i + chunk])))
        except Exception as e:
            return f'arctic fill: failed ({e}) after {known}/{len(ids)} posts, {flagged} flagged NSFW, {filled} bodies; the rest unchecked'
        for d in data.get('data') or []:
            p = posts.get(d.get('id'))
            if p is None:
                continue
            known += 1
            if d.get('over_18'):
                p['over_18'] = True
                flagged += 1
            if not p.get('selftext') and d.get('selftext') not in (None, '', '[removed]', '[deleted]'):
                p['selftext'] = d['selftext']
                filled += 1
    return f'arctic fill: {flagged} flagged NSFW, {filled} bodies filled ({known}/{len(ids)} posts known)'


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
    """channels: {name: Channel}, tried in that order. Returns {sub: {'channel', 'posts'} | {'error'}}."""
    results = {}
    for sub in subs:
        errors = []
        for name, ch in channels.items():
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
    channels = {'browser': browser, 'arctic': Arctic()}
    if browser.disabled:
        print(f'⚠️  browser channel off: {browser.disabled}')
    results = fetch_all(subs, channels)
    print(fill_from_arctic(results))
    stats = {n: {'ok': c.ok, 'failed': c.failed, 'disabled': c.disabled} for n, c in channels.items()}
    ok = sum(1 for r in results.values() if 'posts' in r)
    print(f'📥 {ok}/{len(subs)} subreddits fetched | ' + ' | '.join(f'{n}: {s["ok"]} ok, {s["failed"]} failed' + (f', OFF: {s["disabled"]}' if s['disabled'] else '') for n, s in stats.items()))
    tmp = args.out + '.tmp'
    with open(tmp, 'w') as f:
        json.dump({'generatedAt': time.time(), 'subreddits': results, 'channels': stats}, f)
    os.replace(tmp, args.out)


if __name__ == '__main__':
    sys.exit(main())
