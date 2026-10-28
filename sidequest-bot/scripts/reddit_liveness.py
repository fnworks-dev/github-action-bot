#!/usr/bin/env python3
"""Hide board cards whose Reddit post is gone (removed by mods or Reddit's filters, or deleted).

A user who taps a card and lands on "removed by moderator" feels cheated. On 2026-10-29, 26% of the checkable
Reddit cards pointed at such posts (35 of 35 sampled were really gone), and nothing ever re-checked them.
The logged-in /new.json listings that reddit_local_fetch.py already downloads leave removed and deleted posts out,
so a card whose post time falls inside a fetched listing's span but is missing from it is gone: no extra Reddit
requests. Sets job_posts.status = 'removed' (the board's feed skips it), and back to 'new' if the post shows up
again (a mod approved it).

Usage: reddit_liveness.py FETCH_JSON [--dry-run]   FETCH_JSON = the reddit_local_fetch.py --out file
Needs TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (the bot's .env).
"""
import json, os, sys, urllib.request
from datetime import datetime, timezone

MAX_PER_SUB = 25   # more gone in one sub in one run looks like a broken listing, not moderators
MIN_LISTING = 10   # a listing shorter than this vouches for nothing
WINDOW_DAYS = 14


def listings_from_fetch(fetch):
    """{subreddit (lowercase): posts} for listings read by the logged-in browser. RSS and the Arctic mirror are
    left out: the mirror keeps removed posts, and RSS has not been checked."""
    return {sub.lower(): r['posts'] for sub, r in fetch.get('subreddits', {}).items()
            if r.get('channel') == 'browser' and len(r.get('posts') or []) >= MIN_LISTING}


def post_time(card):
    """Epoch seconds of posted_at ('2026-10-25T23:49:43.000Z') or created_at ('2026-10-26 00:24:54', UTC)."""
    raw = (card.get('posted_at') or card.get('created_at') or '').strip()
    if not raw:
        return None
    try:
        t = datetime.fromisoformat(raw.replace('Z', '+00:00').replace(' ', 'T'))
    except ValueError:
        return None
    return (t if t.tzinfo else t.replace(tzinfo=timezone.utc)).timestamp()


def decide(listings, cards):
    """-> (card ids to hide, card ids to show again, subs skipped as suspicious)."""
    by_sub = {}
    for c in cards:
        by_sub.setdefault((c.get('subreddit') or '').lower(), []).append(c)
    hide, show, skipped = [], [], []
    for sub, posts in listings.items():
        ids = {p['id'] for p in posts}
        lo, hi = min(p['created_utc'] for p in posts), max(p['created_utc'] for p in posts)
        gone, back = [], []
        for c in by_sub.get(sub, []):
            t = post_time(c)
            if t is None or not lo < t < hi:
                continue  # outside what this listing covers: no verdict
            if c['source_id'] in ids:
                if c.get('status') == 'removed':
                    back.append(c['id'])
            elif c.get('status') != 'removed':
                gone.append(c['id'])
        if len(gone) > MAX_PER_SUB:
            skipped.append(sub)
            continue
        hide += gone
        show += back
    return hide, show, skipped


def db(sql, args=()):
    url = os.environ['TURSO_DATABASE_URL'].replace('libsql://', 'https://') + '/v2/pipeline'
    stmt = {'sql': sql, 'args': [{'type': 'text', 'value': str(a)} for a in args]}
    body = json.dumps({'requests': [{'type': 'execute', 'stmt': stmt}, {'type': 'close'}]}).encode()
    req = urllib.request.Request(url, body, {'Authorization': 'Bearer ' + os.environ['TURSO_AUTH_TOKEN'],
                                             'Content-Type': 'application/json', 'User-Agent': 'sidequest-liveness'})
    res = json.load(urllib.request.urlopen(req, timeout=60))['results'][0]
    if res['type'] != 'ok':
        raise RuntimeError(res)
    r = res['response']['result']
    cols = [c['name'] for c in r['cols']]
    return [{c: v.get('value') for c, v in zip(cols, row)} for row in r['rows']]


def set_status(ids, status):
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        db(f"UPDATE job_posts SET status = ?, updated_at = datetime('now') WHERE id IN ({','.join('?' * len(chunk))})",
           [status, *chunk])


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    listings = listings_from_fetch(json.load(open(sys.argv[1])))
    cards = db(f"""SELECT id, source_id, subreddit, posted_at, created_at, status FROM job_posts
                   WHERE lower(source) = 'reddit' AND COALESCE(NULLIF(posted_at, ''), created_at) >= datetime('now', '-{WINDOW_DAYS} days')""")
    hide, show, skipped = decide(listings, cards)
    if '--dry-run' not in sys.argv:
        set_status(hide, 'removed')
        set_status(show, 'new')
    print(f"liveness: {len(cards)} cards, {len(listings)} listings, hid {len(hide)}, restored {len(show)}"
          + (f", skipped suspicious subs {skipped}" if skipped else '') + (' (dry run)' if '--dry-run' in sys.argv else ''))


if __name__ == '__main__':
    main()
