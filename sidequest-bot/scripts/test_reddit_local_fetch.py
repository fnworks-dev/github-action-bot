import os, sys, unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from reddit_local_fetch import Channel, HttpError, fetch_all, parse_atom  # noqa: E402

ATOM = b'''<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><author><name>/u/buyer1</name></author><id>t3_1abc23</id>
<content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Need a VA, $15/hr &amp;amp; flexible&lt;/p&gt;
&lt;ul&gt;&lt;li&gt;email&lt;/li&gt;&lt;/ul&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &lt;a href=&quot;x&quot;&gt; /u/buyer1 &lt;/a&gt;</content>
<link href="https://www.reddit.com/r/forhire/comments/1abc23/hiring_va/"/><published>2026-10-10T01:00:18+00:00</published>
<title>[Hiring] VA</title></entry>
<entry><id>t3_link99</id><content type="html">&lt;table&gt;image&lt;/table&gt;</content>
<link href="https://www.reddit.com/r/forhire/comments/link99/x/"/><updated>2026-10-10T02:00:00+00:00</updated><title>Link post</title></entry>
</feed>'''


class Fake(Channel):
    reddit = False

    def __init__(self, name, outcome):
        super().__init__()
        self.name, self.outcome, self.calls = name, outcome, []

    def fetch(self, sub):
        self.calls.append(sub)
        result = self.outcome(sub) if callable(self.outcome) else self.outcome
        if isinstance(result, Exception):
            raise result
        return result


class Tests(unittest.TestCase):
    def test_parse_atom(self):
        self_post, link_post = parse_atom(ATOM)
        self.assertEqual(self_post['id'], '1abc23')
        self.assertEqual(self_post['author'], 'buyer1')
        self.assertEqual(self_post['permalink'], '/r/forhire/comments/1abc23/hiring_va/')
        self.assertEqual(self_post['selftext'], 'Need a VA, $15/hr & flexible\n\n- email')
        self.assertTrue(self_post['is_self'])
        self.assertEqual(self_post['created_utc'], datetime(2026, 10, 10, 1, 0, 18, tzinfo=timezone.utc).timestamp())
        self.assertFalse(link_post['is_self'])
        self.assertEqual(link_post['selftext'], '')

    def test_split_and_failover(self):
        browser = Fake('browser', ['b'])
        rss = Fake('rss', lambda sub: HttpError(500) if sub == 'two' else ['r'])
        arctic = Fake('arctic', ['a'])
        out = fetch_all(['one', 'two', 'three'], {'browser': browser, 'rss': rss, 'arctic': arctic}, slot=0, pause=lambda: None, log=lambda _: None)
        self.assertEqual(out['one']['channel'], 'browser')   # even index starts with the browser
        self.assertEqual(out['two']['channel'], 'browser')   # rss first, failed, browser took over
        self.assertEqual(out['three']['channel'], 'browser')
        self.assertEqual(rss.calls, ['two'])
        self.assertEqual(arctic.calls, [])

    def test_blocked_channel_is_switched_off_and_dead_subreddit_is_not(self):
        wall = HttpError(403, "You've been blocked by network security.")
        browser = Fake('browser', lambda sub: HttpError(404) if sub == 'gone' else wall)
        rss = Fake('rss', ['r'])
        out = fetch_all(['gone', 'a', 'b', 'c'], {'browser': browser, 'rss': rss, 'arctic': Fake('arctic', [])}, slot=0, pause=lambda: None, log=lambda _: None)
        self.assertIn('blocked by Reddit', browser.disabled)  # switched off by the wall
        self.assertEqual(browser.calls, ['gone', 'b'])        # 404 did not count; the wall at 'b' stopped it
        self.assertTrue(all(out[s]['channel'] == 'rss' for s in ('gone', 'a', 'b', 'c')))

    def test_rate_limit_switches_channel_off_at_once(self):
        rss = Fake('rss', HttpError(429))
        browser = Fake('browser', ['b'])
        out = fetch_all(['a', 'b', 'c', 'd'], {'browser': browser, 'rss': rss, 'arctic': Fake('arctic', [])}, slot=1, pause=lambda: None, log=lambda _: None)
        self.assertEqual(rss.calls, ['a'])                     # one 429, then RSS is left alone
        self.assertIn('rate limited', rss.disabled)
        self.assertTrue(all(out[s]['channel'] == 'browser' for s in 'abcd'))

    def test_all_channels_down(self):
        down = lambda: Fake('x', TimeoutError('timed out'))
        chans = {'browser': down(), 'rss': down(), 'arctic': down()}
        out = fetch_all([f's{i}' for i in range(5)], chans, slot=1, pause=lambda: None, log=lambda _: None)
        self.assertTrue(all('error' in r for r in out.values()))
        self.assertTrue(all(c.disabled for c in chans.values()))  # 3 failures in a row switch each off


if __name__ == '__main__':
    unittest.main()
