#!/usr/bin/env python3
"""Fetch subreddit listings on the laptop for the SideQuest bots (GitHub runners get blocked by Reddit).

Reddit answers every logged-out client on this machine with 403, so three channels are used:
  browser  a real (non-headless) Chromium logged in through a copy of the "sidequestboard" profile cookies,
           drawn on an invisible Xvfb screen so nothing shows on the desktop
  rss      Reddit's public RSS feed
  arctic   the Arctic Shift mirror (what the GitHub bots use)
Half the subreddits start with the browser and half with RSS, swapping every 2 h, so neither channel (nor the
account) carries all the traffic. A subreddit that fails on one channel is tried on the next one.

Usage: reddit_local_fetch.py --out FILE sub [sub ...]
Writes {"generatedAt", "subreddits": {sub: {"channel", "posts"} | {"error"}}, "channels": {name: stats}}.
"""
import argparse, html, json, os, random, re, select, shutil, signal, subprocess, sys, time
import urllib.error, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime

CHROMIUM = os.environ.get('REDDIT_CHROMIUM', '/snap/bin/chromium')
SRC_DATA = os.path.expanduser(os.environ.get('REDDIT_CHROMIUM_USER_DATA', '~/snap/chromium/common/chromium'))
PROFILE = os.environ.get('REDDIT_CHROMIUM_PROFILE', 'Profile 1')  # "sidequestboard", logged in to Reddit
BOT_DIR = os.path.expanduser('~/snap/chromium/common/sqb-reddit-bot')  # snap Chromium can only read under ~/snap
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
            # ponytail: RSS has no NSFW flag; negative filters and the AI scorer still apply. Browser/Arctic carry it.
            'is_self': bool(body), 'over_18': False,
        })
    return posts


def http_get(url, timeout, headers):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise HttpError(e.code, e.read(400).decode('utf-8', 'replace'))


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
    name = 'browser'

    def __init__(self):
        super().__init__()
        self.procs, self.pw, self.page = [], None, None

    def start(self):
        try:
            shutil.rmtree(BOT_DIR, ignore_errors=True)
            os.makedirs(os.path.join(BOT_DIR, PROFILE))
            shutil.copy(os.path.join(SRC_DATA, 'Local State'), BOT_DIR)
            for f in os.listdir(os.path.join(SRC_DATA, PROFILE)):
                if f.startswith('Cookies'):
                    shutil.copy(os.path.join(SRC_DATA, PROFILE, f), os.path.join(BOT_DIR, PROFILE, f))
            r, w = os.pipe()
            self.spawn(['Xvfb', '-displayfd', str(w), '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], pass_fds=[w])
            os.close(w)
            display = os.read(r, 16).decode().strip() if select.select([r], [], [], 20)[0] else ''
            os.close(r)
            if not display:
                raise RuntimeError('virtual screen (Xvfb) did not start')
            uid = os.getuid()
            env = dict(os.environ, DISPLAY=f':{display}')
            env.setdefault('DBUS_SESSION_BUS_ADDRESS', f'unix:path=/run/user/{uid}/bus')  # keyring holds the cookie key
            env.setdefault('XDG_RUNTIME_DIR', f'/run/user/{uid}')
            self.spawn([CHROMIUM, f'--user-data-dir={BOT_DIR}', f'--profile-directory={PROFILE}', '--remote-debugging-port=0',
                        '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', 'about:blank'], env=env)
            port_file, port = os.path.join(BOT_DIR, 'DevToolsActivePort'), ''
            for _ in range(60):
                if os.path.exists(port_file):
                    port = open(port_file).read().split('\n')[0].strip()
                    if port.isdigit():
                        break
                time.sleep(0.5)
            if not port.isdigit():
                raise RuntimeError('Chromium did not start')
            from playwright.sync_api import sync_playwright
            self.pw = sync_playwright().start()
            ctx = self.pw.chromium.connect_over_cdp(f'http://127.0.0.1:{port}', timeout=30000).contexts[0]
            if not any(c['name'] == 'reddit_session' for c in ctx.cookies('https://www.reddit.com')):
                raise RuntimeError('not logged in to Reddit (sidequestboard profile signed out, or desktop keyring locked)')
            self.page = ctx.pages[0] if ctx.pages else ctx.new_page()
        except Exception as e:
            self.disabled = str(e)

    def spawn(self, cmd, **kw):
        self.procs.append(subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, **kw))
        with open(PIDFILE, 'w') as f:
            f.write(' '.join(str(p.pid) for p in self.procs))

    def fetch(self, sub):
        resp = self.page.goto(f'https://www.reddit.com/r/{sub}/new.json?limit=100&raw_json=1', wait_until='domcontentloaded', timeout=30000)
        status = resp.status if resp else 0
        try:
            body = resp.text() if resp else ''
        except Exception:
            body = self.page.inner_text('body')
        if status != 200:
            raise HttpError(status, body[:400])
        return [from_json(c['data']) for c in json.loads(body)['data']['children'] if c.get('kind') == 't3']

    def close(self):
        try:
            if self.pw:
                self.pw.stop()
        except Exception:
            pass
        for p in self.procs:
            kill_group(p.pid, signal.SIGTERM)
        for p in self.procs:
            try:
                p.wait(timeout=8)
            except subprocess.TimeoutExpired:
                kill_group(p.pid, signal.SIGKILL)
        shutil.rmtree(BOT_DIR, ignore_errors=True)
        if os.path.exists(PIDFILE):
            os.remove(PIDFILE)


def kill_group(pid, sig):
    try:
        os.killpg(pid, sig)
    except (ProcessLookupError, PermissionError):
        pass


def kill_leftovers():
    """A killed earlier run can leave its Xvfb/Chromium behind. PIDs get reused, so only kill a process whose
    cmdline proves it is ours (never the owner's own Chromium)."""
    try:
        pids = [int(p) for p in open(PIDFILE).read().split()]
    except (OSError, ValueError):
        return
    for pid in pids:
        try:
            if re.search(rb'sqb-reddit-bot|Xvfb\x00-displayfd', open(f'/proc/{pid}/cmdline', 'rb').read()):
                kill_group(pid, signal.SIGKILL)
        except OSError:
            pass


def fetch_all(subs, channels, slot, pause=lambda: time.sleep(random.uniform(2, 4)), log=print):
    """channels: {'browser', 'rss', 'arctic'} -> Channel. Returns {sub: {'channel', 'posts'} | {'error'}}."""
    results = {}
    for i, sub in enumerate(subs):
        first, second = ('browser', 'rss') if (i + slot) % 2 == 0 else ('rss', 'browser')
        errors = []
        for name in (first, second, 'arctic'):
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
    kill_leftovers()
    browser = Browser()
    browser.start()
    channels = {'browser': browser, 'rss': Rss(), 'arctic': Arctic()}
    if browser.disabled:
        print(f'⚠️  browser channel off: {browser.disabled}')
    try:
        results = fetch_all(subs, channels, slot=int(time.time() // 7200))
    finally:
        browser.close()
    stats = {n: {'ok': c.ok, 'failed': c.failed, 'disabled': c.disabled} for n, c in channels.items()}
    ok = sum(1 for r in results.values() if 'posts' in r)
    print(f'📥 {ok}/{len(subs)} subreddits fetched | ' + ' | '.join(f'{n}: {s["ok"]} ok, {s["failed"]} failed' + (f', OFF: {s["disabled"]}' if s['disabled'] else '') for n, s in stats.items()))
    tmp = args.out + '.tmp'
    with open(tmp, 'w') as f:
        json.dump({'generatedAt': time.time(), 'subreddits': results, 'channels': stats}, f)
    os.replace(tmp, args.out)


if __name__ == '__main__':
    sys.exit(main())
