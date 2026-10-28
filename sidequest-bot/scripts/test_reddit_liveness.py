import os, sys, unittest

sys.path.insert(0, os.path.dirname(__file__))
from reddit_liveness import MAX_PER_SUB, decide, listings_from_fetch, post_time  # noqa: E402

T0 = 1793000000  # listing span: T0 .. T0 + 99h
LISTING = [{'id': f'p{i}', 'created_utc': T0 + i * 3600} for i in range(100)]


def card(cid, source_id, hours, status='new', sub='ForHire'):
    from datetime import datetime, timezone
    iso = datetime.fromtimestamp(T0 + hours * 3600, timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    return {'id': cid, 'source_id': source_id, 'subreddit': sub, 'posted_at': iso, 'created_at': '', 'status': status}


class Liveness(unittest.TestCase):
    def test_hides_cards_missing_from_the_listing_span_and_restores_reapproved_ones(self):
        cards = [
            card('live', 'p10', 10),                       # in the listing: stays
            card('gone', 'x1', 20.5),                      # inside the span, missing: removed or deleted
            card('old', 'x2', -5),                         # older than the listing: no verdict
            card('back', 'p30', 30, status='removed'),     # a mod approved it again
            card('still-gone', 'x3', 40.5, status='removed'),
            card('other-sub', 'x4', 50.5, sub='hungryartists'),  # that sub was not fetched
        ]
        self.assertEqual(decide({'forhire': LISTING}, cards), (['gone'], ['back'], []))

    def test_a_listing_that_lost_too_many_posts_is_skipped(self):
        cards = [card(f'c{i}', f'x{i}', i + 0.5) for i in range(MAX_PER_SUB + 1)]
        self.assertEqual(decide({'forhire': LISTING}, cards), ([], [], ['forhire']))

    def test_only_full_logged_in_listings_count(self):
        fetch = {'subreddits': {
            'ForHire': {'channel': 'browser', 'posts': LISTING},
            'rssSub': {'channel': 'rss', 'posts': LISTING},        # unchecked semantics
            'mirror': {'channel': 'arctic', 'posts': LISTING},     # the mirror keeps removed posts
            'tiny': {'channel': 'browser', 'posts': LISTING[:3]},
            'broken': {'error': 'HTTP 500'},
        }}
        self.assertEqual(list(listings_from_fetch(fetch)), ['forhire'])

    def test_post_time_reads_both_db_formats_as_utc(self):
        self.assertEqual(post_time({'posted_at': '2026-10-25T23:49:43.000Z'}), post_time({'posted_at': '', 'created_at': '2026-10-25 23:49:43'}))
        self.assertIsNone(post_time({'posted_at': '', 'created_at': ''}))


if __name__ == '__main__':
    unittest.main()
