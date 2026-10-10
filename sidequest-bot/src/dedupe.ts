/**
 * When two posts are the same gig: cross-posts, reposts and copy-paste from several accounts.
 * Measured on 2026-10-10 (30-60 days of cards): Reddit 7%, X 4%, Discord 35% of cards were such copies,
 * reposts came up to 14 days later on Reddit (49 on X), and every multi-account copy was a scam ring.
 * Byte-identical copies: github-action-bot sidequest-bot/src/dedupe.ts (Reddit) and sidequestboard-job-fetcher
 * scripts/domain/{twitter,discord}-scraper/src/utils/dedupe.ts. Change all three together.
 */
export const DUPLICATE_WINDOW_DAYS = 30;

const LEADING_TAGS = /^\s*(?:[[({][^\])}]{0,30}[\])}]\s*[-:|]*\s*)+/; // "[Hiring] (PAID) - "
const norm = (s: string | null | undefined): string => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * A post is a duplicate when any of its keys matches a stored job's keys.
 * useTitle=false for Discord: its titles are generic first lines ("Remote Jobs", "Hiring"), and half of its
 * same-author same-title pairs were different posts. Reddit and X titles are specific.
 */
export function duplicateKeys(post: { author: string | null; title: string; content: string | null }, useTitle = true): string[] {
    const author = (post.author ?? '').trim().toLowerCase();
    const title = norm(post.title.replace(LEADING_TAGS, ''));
    const body = norm(post.content);
    const keys: string[] = [];
    if (author && author !== '[deleted]') {
        if (useTitle && title.length >= 8) keys.push(`t:${author}:${title}`); // repost or cross-post
        if (body.length >= 100) keys.push(`b:${author}:${body.slice(0, 100)}`); // same post, title reworded per sub
    }
    if (body.length >= 150) keys.push(`c:${body.slice(0, 150)}`); // same long text from several accounts
    return keys;
}
