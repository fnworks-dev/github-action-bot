/**
 * Shared content filters for SideQuest bots.
 * Used by all config variants' shouldFilterPost() to keep behavior uniform.
 */

// Terms that indicate the post itself offers or requests adult/NSFW work.
// Matched against title + content, case-insensitive.
// Keep terms specific — avoid false positives on legitimate posts (e.g. "safe" contains "sfw"... use word "nsfw" deliberately).
const NSFW_TERMS = [
    'nsfw',
    '18+',
    'adult content',
    'explicit content',
    'erotic',
    'erotica',
    'porn',
    'hentai',
    'fetish',
    'kink',
    'kinks',
    'nude',
    'nudes',
    'nudity',
    'lewd',
    'smut',
    'r34',
    'rule 34',
    'rule34',
    'yiff',
    'ecchi',
    'xxx',
    'camgirl',
    'onlyfans',
    'fansly',
];

// Patterns that signal low-value/junk content (matched against title + content).
const JUNK_PATTERNS: RegExp[] = [
    // Title-only "[For Hire]"/"[Hiring]" with no other words (low effort, nothing to classify)
    /^\s*\[(for hire|hiring|paid|unpaid)\]\s*$/i,
    // Discord/community invite spam
    /discord\.gg\/\S+/i,
    // Link-shortener spam
    /\b(bit\.ly|tinyurl|cutt\.ly|shorturl)\b\/\S*/i,
];

/**
 * True if title/content indicates adult/NSFW work (offered or requested).
 */
export function isNsfwContent(title: string, content: string | null): boolean {
    const text = `${title} ${content || ''}`.toLowerCase();
    // "sfw" alone is fine; only flag when paired with nsfw-ish terms above.
    return NSFW_TERMS.some((term) => text.includes(term));
}

/**
 * True if the post looks like low-effort junk (title-only tags, invite/link spam).
 */
export function isJunkContent(title: string, content: string | null): boolean {
    const text = `${title} ${content || ''}`;
    return JUNK_PATTERNS.some((re) => re.test(text) || re.test(title));
}

/**
 * Combined filter used by shouldFilterPost implementations.
 */
export function shouldFilterShared(title: string, content: string | null): boolean {
    return isNsfwContent(title, content) || isJunkContent(title, content);
}
