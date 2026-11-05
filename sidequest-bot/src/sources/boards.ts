/**
 * Public job boards (no login), fetched from the laptop next to Reddit: job-fetcher
 * scripts/domain/run_boards_scraper.sh -> dist/index-boards.js. Why these boards and the rules per board:
 * job-fetcher docs/handoff-new-job-sources-2026-11-05.md.
 *
 * A board lists its newest posts in the RawPost shape; its own fields can already decide a post:
 * `hint` = the professions they give (empty: the AI decides), `drop` = why the post is out before any AI call.
 * `detail` fetches the full text, only for posts that are new and not dropped.
 */
import type { JobSource, Profession, RawPost } from '../types.js';

export interface BoardPost extends RawPost {
    hint: Profession[];
    drop?: string;
}

export interface Board {
    name: string;
    list(): Promise<BoardPost[]>;
    detail?(post: BoardPost): Promise<Partial<BoardPost>>;
}

const UA = 'SideQuestBoard/1.0 (+https://sidequestboard.app)';
// One request at a time across all boards, at least this far apart (Casting Call Club asks for 1 s).
const GAP_MS = 1500;
let lastRequest = 0;

async function get(url: string, headers: Record<string, string> = {}): Promise<string> {
    const wait = lastRequest + GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
        // Blender Artists' category JSON sometimes takes over 30 s
        const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.text();
    } finally {
        lastRequest = Date.now();
    }
}

const NAMED: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

export function decode(s: string): string {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
        if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
        const n = Number(e[1] === 'x' || e[1] === 'X' ? `0${e.slice(1)}` : e.slice(1));
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    });
}

/** HTML to plain text, keeping paragraph and list breaks. */
export function text(html: string | null | undefined): string {
    return decode((html ?? '')
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, ''))
        .replace(/[ \t\u00a0]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/^-\n+/gm, '- ') // <li><p>text</p></li>
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const iso = (s: string): string | null => {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
};

const rssItems = (xml: string): string[] => xml.split(/<item\b[^>]*>/).slice(1).map((s) => s.split('</item>')[0]);

function field(item: string, tag: string): string {
    const m = item.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
    if (!m) return '';
    const value = m[1].trim();
    const cdata = value.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
    return cdata ? cdata[1] : decode(value);
}

/** First paragraph of the list-time content: the pay/type line the detail fetch keeps on top. */
const head = (post: BoardPost): string => (post.content ?? '').split('\n\n')[0];

// --- Casting Call Club: paid projects, newest first. robots.txt allows /api/ (crawl-delay 1 s).
const CCC_ROLES: Record<string, Profession> = {
    voice_actor: 'voice-actor',
    singer: 'audio',
    music_composer: 'audio',
    audio_engineer: 'audio',
    writer: 'writer',
    video_editor: 'video-editor',
    artist: 'artist',
    animator: 'artist',
}; // live_actor (on camera) has no profession here

interface CccRole { isA: string; kind: string; payment: string; paymentTotal?: string | null; paymentInterval?: string | null }
interface CccProject { projectId: number; slug: string; name: string; category: string; listedAt: string; description: string | null; username: string }

export function parseCastingCall(json: string): BoardPost[] {
    const { results } = JSON.parse(json) as { results: { project: CccProject; roles: CccRole[] }[] };
    return results.map(({ project: p, roles }): BoardPost => {
        const paid = roles.filter((r) => r.payment === 'paid' && CCC_ROLES[r.isA]);
        const pay = paid.map((r) => `${r.kind}: ${r.paymentTotal || 'paid'}${r.paymentInterval ? `, ${r.paymentInterval.toLowerCase()}` : ''}`);
        return {
            source: 'castingcall',
            sourceId: String(p.projectId),
            sourceUrl: `https://www.castingcall.club/projects/${p.slug}`,
            title: p.name,
            content: `${[...new Set(pay)].join('; ')}\n\n${text(p.description)}`,
            author: p.username,
            subreddit: null,
            postedAt: p.listedAt,
            hint: [...new Set(paid.map((r) => CCC_ROLES[r.isA]))],
            drop: p.category === 'roleplay' ? 'roleplay project' : paid.length ? undefined : 'no paid role with a profession here',
        };
    });
}

const castingcall: Board = {
    name: 'Casting Call Club',
    list: async () => parseCastingCall(await get('https://www.castingcall.club/api/v3/omnisearch/projects_kick?payment=paid&order_by=listed_at&search=is:all&page=1')),
    // The API lowercases all text; the project page has the title and each role's description as written.
    async detail(post) {
        const html = await get(post.sourceUrl);
        const title = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1];
        const roles = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
            .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
            .filter((d) => d?.['@type'] === 'JobPosting') as { title: string; description: string }[];
        return {
            title: title ? decode(title) : post.title,
            content: roles.length ? [head(post), ...roles.map((r) => `${r.title}\n${text(r.description)}`)].join('\n\n') : post.content,
        };
    },
};

// --- YT Jobs: the RSS feed has every new post with its exact time, the JSON API the details.
const YT_AREAS: Record<string, Profession> = { 1: 'video-editor', 3: 'artist', 8: 'writer' }; // editor, thumbnail designer, scriptwriter
const YT_TYPES: Record<string, string> = { 1: 'per project', 3: 'full-time', 5: 'part-time' }; // read off job pages 2026-11-05

export function parseYtFeed(xml: string): BoardPost[] {
    return rssItems(xml).map((item): BoardPost => {
        const url = field(item, 'link');
        return {
            source: 'ytjobs',
            sourceId: url.match(/\/job\/(\d+)/)?.[1] ?? url,
            sourceUrl: url,
            title: field(item, 'title'),
            content: null,
            author: field(item, 'author') || null,
            subreddit: null,
            postedAt: iso(field(item, 'pubDate')),
            hint: [],
        };
    });
}

interface YtJob {
    jobTitle: string; jobType: string; functionalArea: string; status: string;
    minSalary: number | null; maxSalary: number | null; description: string | null; htmlContent: string | null;
    locationType: string | null; locationDetails?: { countryName: string | null };
    company?: { name: string; abvSubscribers: string | null };
}

export function parseYtJob(json: string, post: BoardPost): Partial<BoardPost> {
    const j = JSON.parse(json) as YtJob;
    const area = YT_AREAS[j.functionalArea];
    const country = j.locationDetails?.countryName;
    const pay = j.minSalary && j.maxSalary ? `$${j.minSalary}–$${j.maxSalary}`
        : j.maxSalary ? `up to $${j.maxSalary}` : j.minSalary ? `from $${j.minSalary}` : 'pay not listed';
    const channel = j.company ? `${j.company.name} (${j.company.abvSubscribers ?? '?'} subscribers)` : 'channel';
    return {
        title: j.jobTitle || post.title,
        author: j.company?.name ?? post.author,
        content: `${YT_TYPES[j.jobType] ?? 'job'}, ${pay}, ${channel}\n\n${text(j.htmlContent || j.description)}`,
        hint: area ? [area] : [],
        drop: j.status !== 'active' ? `status ${j.status}`
            : j.jobType === '3' ? 'full-time'
            : !area ? `role area ${j.functionalArea}: channel manager, strategist, producer or other`
            : j.locationType !== 'Remote' && country && country !== 'United States' ? `on-site in ${country}`
            : undefined,
    };
}

const ytjobs: Board = {
    name: 'YT Jobs',
    list: async () => parseYtFeed(await get('https://app.ytjobs.co/feeds')),
    detail: async (post) => parseYtJob(await get(`https://app.ytjobs.co/api/jobs/${post.sourceId}`, { Accept: 'application/json' }), post),
};

// --- Hubstaff Talent: the search page's XHR answer is JS that writes escaped HTML into the page, 15 newest posts.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "November  5, 2026 at  1:23 pm", in UTC (matched the page's "2 hrs ago" on 2026-11-05). */
function hubstaffTime(s: string): string | null {
    const m = s.match(/([a-z]+)\s+(\d+),\s+(\d{4})\s+at\s+(\d+):(\d+)\s*([ap]m)/i);
    const month = m ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) : -1;
    if (!m || month < 0) return null;
    const hour = (Number(m[4]) % 12) + (m[6].toLowerCase() === 'pm' ? 12 : 0);
    return new Date(Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5]))).toISOString();
}

export function parseHubstaff(js: string): BoardPost[] {
    const html = js.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c));
    return html.split('<div class="search-result">').slice(1).map((card): BoardPost => {
        const pick = (re: RegExp) => decode(card.match(re)?.[1]?.trim() ?? '');
        const slug = pick(/href="\/jobs\/([^"?#]+)"/);
        const type = pick(/\blabel-([a-z_]+)/);
        const title = pick(/class="name[^"]*"[^>]*>([^<]+)</);
        const bio = pick(/class="profil-bio[^"]*">([^<]*)</);
        const pay = pick(/class="pay-rate">([^<]*)</);
        const hq = pick(/<strong>HQ:<\/strong>([^<]*)</);
        return {
            source: 'hubstaff',
            sourceId: slug,
            sourceUrl: `https://hubstafftalent.net/jobs/${slug}`,
            title,
            content: `${type.replace('_', ' ')}${pay ? `, ${pay}` : ''}${hq ? `, company HQ ${hq}` : ''}\n\n${bio}`,
            author: pick(/job-agency[^>]*>(?:\s*<i[^>]*><\/i>)?([^<]+)</) || null,
            subreddit: null,
            postedAt: hubstaffTime(pick(/data-original-title="([^"]+)"/)),
            hint: [],
            drop: type === 'full_time' ? 'full-time'
                : /commission[- ]only|uncapped commission|\b(language|english|esl) (teacher|tutor)/i.test(`${title} ${bio}`) ? 'commission-only sales or language teaching'
                : undefined,
        };
    });
}

const hubstaff: Board = {
    name: 'Hubstaff Talent',
    list: async () => parseHubstaff(await get(
        'https://hubstafftalent.net/search/jobs?search%5Bkeywords%5D=&search%5Bsort_by%5D=date_added&page=1',
        { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/javascript, application/javascript, */*; q=0.01' },
    )),
    async detail(post) {
        const body = (await get(post.sourceUrl)).match(/class="job-description[^"]*">([\s\S]*?)<\/div>/)?.[1];
        return body ? { content: `${head(post)}\n\n${text(body)}` } : {};
    },
};

// --- Work With Indies (games): titles read "<Studio> is hiring a <Role> to work from <Place>", tags give type and field.
const WWI_FIELDS: Record<string, Profession> = { 'Art & Animation': 'artist', Programming: 'developer', 'QA & CS': 'qa', Audio: 'audio', Writing: 'writer' };
// The role name too: a "Graphic Designer" can be tagged Marketing & Community
const WWI_ROLES: [RegExp, Profession][] = [
    [/artist|animator|illustrat|graphic design|\bui\b|modell?er|concept/i, 'artist'],
    [/programmer|developer|engineer/i, 'developer'],
    [/\bqa\b|tester/i, 'qa'],
    [/composer|sound|audio|music/i, 'audio'],
    [/writer/i, 'writer'],
];
// Case-sensitive: "PT ± 3 hours" is a US time zone, "Lisbon, PT" is Portugal; "CET ± 3 hours" is Europe.
const US_OR_ANYWHERE = /[Aa]nywhere|[Rr]emote|United States|North America|\bUSA?\b|\b[ECMP][SD]?T ±/;

export function parseWorkWithIndies(xml: string): BoardPost[] {
    return rssItems(xml).map((item): BoardPost => {
        const title = field(item, 'title');
        const [, studio = '', role = title, place = ''] = title.match(/^(.*?) is hiring (?:an? )?(.*?) to work from (.*)$/) ?? [];
        const description = field(item, 'description');
        const tags = [...description.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
        const hint = [...new Set([...tags.map((t) => WWI_FIELDS[t]), ...WWI_ROLES.filter(([re]) => re.test(role)).map(([, p]) => p)].filter(Boolean))];
        const url = field(item, 'link');
        return {
            source: 'workwithindies',
            sourceId: url.split('/').pop() || url,
            sourceUrl: url,
            title: studio ? `${role} at ${studio}` : title,
            content: `${tags.join(', ')}; work from ${place || 'not given'}\n\n${description.replace(/\s*Tags:[\s\S]*$/, '')}`,
            author: studio || null,
            subreddit: null,
            postedAt: iso(field(item, 'pubDate')),
            hint,
            drop: !tags.some((t) => /^(contract|freelance|part time)$/i.test(t)) ? 'full-time'
                : !hint.length ? `field ${tags.join(', ')}: no profession here`
                : !US_OR_ANYWHERE.test(place) ? `location ${place}`
                : undefined,
        };
    });
}

const workwithindies: Board = {
    name: 'Work With Indies',
    list: async () => parseWorkWithIndies(await get('https://www.workwithindies.com/careers/rss.xml')),
    async detail(post) {
        const body = (await get(post.sourceUrl)).match(/class="job-description w-richtext">([\s\S]*?)<\/div>/)?.[1];
        return body ? { content: `${head(post)}\n\n${text(body)}` } : {};
    },
};

// --- Blender Artists, Paid Work category (Discourse JSON). The pinned topics are the category's rules.
interface Topic { id: number; title: string; slug: string; created_at: string; pinned: boolean; closed: boolean; archived: boolean; posters: { description: string; user_id: number }[] }

export function parseBlenderArtists(json: string): BoardPost[] {
    const d = JSON.parse(json) as { users: { id: number; username: string }[]; topic_list: { topics: Topic[] } };
    return d.topic_list.topics.filter((t) => !t.pinned).map((t): BoardPost => {
        const op = t.posters.find((p) => /original poster/i.test(p.description))?.user_id;
        return {
            source: 'blenderartists',
            sourceId: String(t.id),
            sourceUrl: `https://blenderartists.org/t/${t.slug}/${t.id}`,
            title: decode(t.title),
            content: null,
            author: d.users.find((u) => u.id === op)?.username ?? null,
            subreddit: null,
            postedAt: t.created_at,
            hint: [], // 3D art, animation or motion graphics: the AI picks artist or video-editor
            drop: t.closed || t.archived ? 'closed' : undefined,
        };
    });
}

const blenderartists: Board = {
    name: 'Blender Artists',
    list: async () => parseBlenderArtists(await get('https://blenderartists.org/c/jobs/paid-work/53.json', { Accept: 'application/json' })),
    async detail(post) {
        const d = JSON.parse(await get(`https://blenderartists.org/t/${post.sourceId}.json`, { Accept: 'application/json' })) as
            { post_stream: { posts: { cooked: string; username: string }[] } };
        const first = d.post_stream.posts[0];
        return { content: text(first.cooked), author: first.username };
    },
};

// --- jobs.wordpress.net: WordPress projects, full text in the feed.
export function parseWordpressJobs(xml: string): BoardPost[] {
    return rssItems(xml).map((item): BoardPost => {
        const title = field(item, 'title');
        const url = field(item, 'link');
        return {
            source: 'wordpressjobs',
            sourceId: field(item, 'post-id') || url,
            sourceUrl: url,
            title,
            content: text(field(item, 'content:encoded') || field(item, 'description')),
            author: null, // every post says "jobposter"
            subreddit: null,
            postedAt: iso(field(item, 'pubDate')),
            hint: ['developer'],
            drop: /full[- ]?time|\blead\b|dedicated|in[- ]house/i.test(title) ? 'staff role' : undefined,
        };
    });
}

const wordpressjobs: Board = {
    name: 'jobs.wordpress.net',
    list: async () => parseWordpressJobs(await get('https://jobs.wordpress.net/feed/')),
};

// --- ProBlogger job board: HTML only (its feed is empty). Freelance and contract writing posts.
export function parseProblogger(html: string): BoardPost[] {
    return html.split('<div class="wpjb-grid-row').slice(1).flatMap((row): BoardPost[] => {
        const link = row.match(/href="(https:\/\/problogger\.com\/jobs\/job\/([^"/]+)\/?)"[^>]*>([^<]+)</);
        const type = row.match(/wpjb-type-([a-z-]+)/)?.[1];
        if (!link || !type) return []; // rows without a type are the sidebar's links to the same jobs
        const company = row.match(/wpjb-sub wpjb-sub-small">([^<]*)</)?.[1].trim();
        return [{
            source: 'problogger',
            sourceId: link[2],
            sourceUrl: link[1],
            title: decode(link[3].trim()),
            content: null,
            author: company ? decode(company) : null,
            subreddit: null,
            postedAt: null, // the list shows "Oct, 29" without a year; the post page has the full date
            hint: ['writer'],
            drop: type === 'freelance' || type === 'contract' ? undefined : `job type ${type}`,
        }];
    });
}

const problogger: Board = {
    name: 'ProBlogger',
    list: async () => parseProblogger(await get('https://problogger.com/jobs/')),
    async detail(post) {
        const html = await get(post.sourceUrl);
        const published = html.match(/Published:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
        const body = html.match(/class="wpjb-text">([\s\S]*?)<\/div>/)?.[1];
        return { postedAt: published ? iso(`${published} 00:00 UTC`) : null, content: body ? text(body) : null };
    },
};

/** In fetch order: the professions the board needs most first (voice, writer, VA, audio). */
export const BOARDS: Record<Exclude<JobSource, 'reddit'>, Board> = {
    castingcall, ytjobs, hubstaff, workwithindies, blenderartists, wordpressjobs, problogger,
};
