import json, os, sys, tempfile, unittest
from datetime import datetime, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import reddit_local_fetch as rlf  # noqa: E402
from reddit_local_fetch import Browser, Channel, HttpError, fetch_all, fill_from_arctic  # noqa: E402

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
    def test_failover_order(self):
        browser = Fake('browser', lambda sub: TimeoutError('slow') if sub == 'two' else ['b'])
        rss = Fake('rss', lambda sub: HttpError(500) if sub == 'two' else ['r'])
        arctic = Fake('arctic', ['a'])
        out = fetch_all(['one', 'two', 'three'], {'browser': browser, 'rss': rss, 'arctic': arctic}, pause=lambda: None, log=lambda _: None)
        self.assertEqual([out[s]['channel'] for s in ('one', 'two', 'three')], ['browser', 'arctic', 'browser'])
        self.assertEqual(rss.calls, ['two'])                 # only asked when the browser failed
        self.assertEqual(arctic.calls, ['two'])

    def test_browser_hands_out_prefetched_listings(self):
        b = Browser()
        b.results = {'ok': {'posts': [{'id': '1abc23'}, {'id': 'link99'}]}, 'gone': {'status': 404, 'error': 'other: page not found'},
                     'wall': {'status': 403, 'error': "blocked: You've been blocked by network security."}}
        b.stopped = 'blocked at r/wall'
        arctic = Fake('arctic', ['a'])
        out = fetch_all(['ok', 'gone', 'wall', 'later'], {'browser': b, 'rss': Fake('rss', HttpError(429)), 'arctic': arctic},
                        pause=lambda: None, log=lambda _: None)
        self.assertEqual(out['ok']['channel'], 'browser')
        self.assertEqual([p['id'] for p in out['ok']['posts']], ['1abc23', 'link99'])
        self.assertIn('blocked by Reddit', b.disabled)       # the wall switched it off; the dead subreddit did not
        self.assertEqual(arctic.calls, ['gone', 'wall', 'later'])

    def test_blocked_channel_is_switched_off_and_dead_subreddit_is_not(self):
        wall = HttpError(403, "You've been blocked by network security.")
        browser = Fake('browser', lambda sub: HttpError(404) if sub == 'gone' else wall)
        rss = Fake('rss', ['r'])
        out = fetch_all(['gone', 'a', 'b', 'c'], {'browser': browser, 'rss': rss, 'arctic': Fake('arctic', [])}, pause=lambda: None, log=lambda _: None)
        self.assertIn('blocked by Reddit', browser.disabled)  # switched off by the wall
        self.assertEqual(browser.calls, ['gone', 'a'])        # 404 did not count; the wall at 'a' stopped it
        self.assertTrue(all(out[s]['channel'] == 'rss' for s in ('gone', 'a', 'b', 'c')))

    def test_rate_limit_switches_channel_off_at_once(self):
        rss = Fake('rss', HttpError(429))
        browser = Fake('browser', HttpError(404))              # nothing from the browser, without switching it off
        out = fetch_all(['a', 'b', 'c', 'd'], {'browser': browser, 'rss': rss, 'arctic': Fake('arctic', ['x'])}, pause=lambda: None, log=lambda _: None)
        self.assertEqual(rss.calls, ['a'])                     # one 429, then RSS is left alone
        self.assertIn('rate limited', rss.disabled)
        self.assertTrue(all(out[s]['channel'] == 'arctic' for s in 'abcd'))

    def test_fill_from_arctic_and_fail_open(self):
        def results():
            return {'a': {'channel': 'browser', 'posts': [{'id': 'x1', 'over_18': False, 'selftext': 'own text'},
                                                          {'id': 'x2', 'over_18': False, 'selftext': ''}]},
                    'b': {'channel': 'browser', 'posts': [{'id': 'x3', 'over_18': False, 'selftext': ''}]},
                    'c': {'channel': 'arctic', 'posts': [{'id': 'x4', 'over_18': False, 'selftext': ''}]}, 'd': {'error': 'down'}}
        urls = []
        def get(url):
            urls.append(url)
            asked = url.split('ids=')[1].split(',')
            known = ({'id': 'x1', 'over_18': False, 'selftext': 'mirror text'}, {'id': 'x2', 'over_18': True, 'selftext': 'gig details'},
                     {'id': 'x3', 'over_18': False, 'selftext': '[removed]'})
            return json.dumps({'data': [d for d in known if d['id'] in asked]})
        r = results()
        self.assertIn('1 flagged', fill_from_arctic(r, get, chunk=2))
        self.assertEqual([p['over_18'] for p in r['a']['posts'] + r['b']['posts']], [False, True, False])
        # a gallery card's empty body is filled in; a card's own text and a removed body are not replaced
        self.assertEqual([p['selftext'] for p in r['a']['posts'] + r['b']['posts']], ['own text', 'gig details', ''])
        self.assertEqual(len(urls), 2)  # x1,x2 then x3; arctic posts carry their own flag and body
        self.assertNotIn('x4', ''.join(urls))
        def down(url):
            raise HttpError(522)
        r = results()
        self.assertIn('failed', fill_from_arctic(r, down))
        self.assertFalse(any(p['over_18'] for x in r.values() for p in x.get('posts', [])))

    def test_arctic_retries_when_its_server_aborts(self):
        def get(*outcomes):
            with mock.patch.object(rlf, 'http_get', side_effect=list(outcomes)) as http:
                try:
                    return rlf.arctic_get('https://arctic/x', 1, wait=0), http.call_count
                except Exception as e:
                    return type(e).__name__, http.call_count
        self.assertEqual(get(HttpError(422), TimeoutError('read'), b'ok'), (b'ok', 3))
        self.assertEqual(get(HttpError(520), b'ok'), (b'ok', 2))
        self.assertEqual(get(HttpError(400)), ('HttpError', 1))  # a bad request is not retried
        self.assertEqual(get(*[HttpError(422)] * 3), ('HttpError', 3))  # gives up after the third try
        with mock.patch.object(rlf.time, 'sleep') as sleep:  # a 429 waits as long as the answer says, at most 30 s
            get(HttpError(429, headers={'x-ratelimit-reset': '7'}), HttpError(429, headers={'x-ratelimit-reset': '300'}), b'ok')
            self.assertEqual([c.args[0] for c in sleep.call_args_list], [8.0, 30])

    def test_browser_result_survives_unicode_line_separators(self):
        # JSON.stringify leaves U+2028/U+2029/U+0085 raw and str.splitlines() splits at them: one r/hiring post with a
        # U+2028 turned the 2026-11-19 07:18 run's browser result into "JSONDecodeError ... (char 0)".
        with tempfile.TemporaryDirectory() as d:
            fake = os.path.join(d, 'fake.mjs')
            with open(fake, 'w') as f:
                f.write("console.log('progress');\n"
                        "console.log(JSON.stringify({subs: {x: {posts: [{id: '1', selftext: 'a\\u2028b\\u2029c\\u0085d'}]}}, stopped: null}));\n")
            silent = os.path.join(d, 'silent.mjs')
            open(silent, 'w').close()
            b, b2 = Browser(), Browser()
            with mock.patch.object(rlf, 'PIDFILE', os.path.join(d, 'pids')):
                with mock.patch.object(rlf, 'BROWSER_FETCH', fake):
                    b.start(['x'])
                with mock.patch.object(rlf, 'BROWSER_FETCH', silent):
                    b2.start(['x'])
        self.assertIsNone(b.disabled)
        self.assertEqual(b.fetch('x')[0]['selftext'], 'a\u2028b\u2029c\u0085d')
        self.assertIn('no result', b2.disabled)  # a fetcher that printed nothing says so

    def test_all_channels_down(self):
        down = lambda: Fake('x', TimeoutError('timed out'))
        chans = {'browser': down(), 'rss': down(), 'arctic': down()}
        out = fetch_all([f's{i}' for i in range(5)], chans, pause=lambda: None, log=lambda _: None)
        self.assertTrue(all('error' in r for r in out.values()))
        self.assertTrue(all(c.disabled for c in chans.values()))  # 3 failures in a row switch each off


if __name__ == '__main__':
    unittest.main()
