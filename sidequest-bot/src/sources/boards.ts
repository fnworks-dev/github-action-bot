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
export const MAX_AGE_MS = 72 * 3_600_000; // boards keep posts open for weeks; older ones were seen before or are going stale
const older = (post: BoardPost): boolean => !!post.postedAt && Date.now() - Date.parse(post.postedAt) > MAX_AGE_MS;

async function get(url: string, headers: Record<string, string> = {}): Promise<string> {
    const wait = lastRequest + GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
        // Blender Artists' category JSON sometimes takes over 30 s
        const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { status: res.status });
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

/** Any date string to the one format the dashboard sorts as text (`2026-11-04T14:00:00.000Z`); no or bad date -> null. */
export const iso = (s: string | null | undefined): string | null => {
    const t = s ? Date.parse(s) : NaN;
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
        hint: area ? [area] : [], // other areas (channel manager, strategist, producer...): the AI decides
        drop: j.status !== 'active' ? `status ${j.status}`
            : j.jobType === '3' ? 'full-time'
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
            hint, // empty (Design, Marketing & Community...): the AI decides
            drop: !tags.some((t) => /^(contract|freelance|part time)$/i.test(t)) ? 'full-time'
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

// --- Employer career pages: companies that keep hiring freelancers, read from their job-board software's public JSON.
// This is how All Freelance Writing finds its gigs: on 2026-11-06, 16 of its 23 listings linked to an employer's own
// Breezy, Lever, Greenhouse, Ashby or JazzHR page or website. Seeded with those employers; add more as [software, board, name].
const CAREERS: [keyof typeof ATS, string, string][] = [
    ['breezy', 'compose-ly', 'Compose.ly'],
    ['breezy', 'quatrain-creative', 'Quatrain Creative'],
    ['breezy', 'sciencebuzz', 'ScienceBuzz'],
    ['greenhouse', 'straightarrownews', 'Straight Arrow News'],
    ['lever', 'everlywell', 'Everlywell'],
    ['ashby', 'intro', 'Intro'],
]; // not ION Group (Lever 'ion'): 1.6 MB and over 60 s per read for 3 freelance roles out of 93
const GIG_TYPE = /contract|freelance|part[- ]?time|temporary|service provider/i;

interface Opening { id: string; url: string; title: string; type: string; place: string; postedAt: string | null; pay?: string | null; body?: string | null }

const ATS = {
    breezy: {
        url: (board: string) => `https://${board}.breezy.hr/json`,
        parse: (json: string): Opening[] => (JSON.parse(json) as {
            id: string; name: string; url: string; published_date: string; salary?: string;
            type?: { name: string }; location?: { name: string; is_remote: boolean };
        }[]).map((j) => ({
            id: j.id, url: j.url, title: j.name, type: j.type?.name ?? 'not stated', pay: j.salary, postedAt: j.published_date,
            place: `${j.location?.name ?? ''}${j.location?.is_remote ? ', remote' : ''}`,
        })),
    },
    lever: {
        url: (board: string) => `https://api.lever.co/v0/postings/${board}?mode=json`,
        parse: (json: string): Opening[] => (JSON.parse(json) as {
            id: string; text: string; hostedUrl: string; createdAt: number; workplaceType?: string;
            categories?: { commitment?: string; location?: string }; descriptionPlain?: string; additionalPlain?: string;
            lists?: { text: string; content: string }[];
        }[]).map((j) => ({
            id: j.id, url: j.hostedUrl, title: j.text, type: j.categories?.commitment ?? 'not stated',
            place: [j.categories?.location, j.workplaceType].filter(Boolean).join(', '), postedAt: new Date(j.createdAt).toISOString(),
            body: [j.descriptionPlain, ...(j.lists ?? []).map((l) => `${l.text}\n${text(l.content)}`), j.additionalPlain].filter(Boolean).join('\n\n'),
        })),
    },
    greenhouse: {
        url: (board: string) => `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
        parse: (json: string): Opening[] => (JSON.parse(json) as {
            jobs: { id: number; title: string; absolute_url: string; first_published?: string; updated_at: string; location?: { name: string }; content: string }[];
        }).jobs.map((j) => ({
            id: String(j.id), url: j.absolute_url, title: j.title, place: j.location?.name ?? '', postedAt: j.first_published ?? j.updated_at,
            type: GIG_TYPE.test(j.title) ? 'freelance or contract (title)' : 'not stated', // no type field in this API
            body: text(decode(j.content)), // the HTML comes entity-escaped
        })),
    },
    ashby: {
        url: (board: string) => `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`,
        parse: (json: string): Opening[] => (JSON.parse(json) as {
            jobs: { id: string; title: string; jobUrl: string; employmentType: string; location: string; isRemote: boolean; publishedAt: string;
                descriptionPlain?: string; compensation?: { compensationTierSummary?: string } }[];
        }).jobs.map((j) => ({
            id: j.id, url: j.jobUrl, title: j.title, type: j.employmentType, place: `${j.location}${j.isRemote ? ', remote' : ''}`,
            postedAt: j.publishedAt, pay: j.compensation?.compensationTierSummary, body: j.descriptionPlain,
        })),
    },
};

/** Location is left to the scorer's board rules: these pages write it too many ways ("Remote US", "Sydney", "United States, remote"). */
export function parseCareers(ats: keyof typeof ATS, board: string, company: string, json: string): BoardPost[] {
    return ATS[ats].parse(json).map((o): BoardPost => ({
        source: 'careers',
        sourceId: `${ats}:${board}:${o.id}`,
        sourceUrl: o.url,
        title: o.title,
        content: `${o.type}, ${o.place || 'location not given'}${o.pay ? `, ${o.pay}` : ''}\n\n${o.body ?? ''}`.trim(),
        author: company,
        subreddit: null,
        postedAt: o.postedAt,
        hint: [],
        drop: GIG_TYPE.test(o.type) ? undefined : `job type ${o.type}`,
    }));
}

const careers: Board = {
    name: 'an employer career page',
    async list() {
        const posts: BoardPost[] = [];
        const failed: string[] = [];
        for (const [ats, board, company] of CAREERS) {
            try {
                posts.push(...parseCareers(ats, board, company, await get(ATS[ats].url(board), { Accept: 'application/json' })));
            } catch (error) { // one slow or moved employer page must not hide the others (Lever took 60+ s on 2026-11-06)
                failed.push(company);
                console.error(`[boards]    ⚠️ careers ${company} (${ats} ${board}): ${error instanceof Error ? error.message : error}`);
            }
        }
        if (failed.length === CAREERS.length) throw new Error('every employer page failed');
        return posts;
    },
    async detail(post) { // only Breezy's list leaves out the description
        if (!post.sourceUrl.includes('.breezy.hr/')) return {};
        const body = (await get(post.sourceUrl)).match(/class="description">([\s\S]*?)<\/div>/)?.[1];
        return body ? { content: `${head(post)}\n\n${text(body)}` } : {};
    },
};

// --- Himalayas: an index of 100k+ remote jobs from company career pages, the wide net version of the list above.
// Its API terms (https://himalayas.app/api) allow showing the jobs on our own site if: Apply uses applicationLink
// unchanged, Himalayas is credited, jobs are not passed on (feeds, JobPosting markup), and closed jobs are removed.
// Every profession we list; search reads the whole job text. 2026-11-06: ~145 US-open gig jobs in 72 h, ~35 requests a run.
const HZ_QUERIES = [
    'developer', 'software engineer', 'game', 'designer', 'illustrator', '3d', 'animator', 'artist', 'voice', 'video',
    'writer', 'copywriter', 'editor', 'content', 'translator', 'audio', 'sound', 'music', 'composer', 'podcast',
    'qa', 'tester', 'assistant', 'customer support', 'data entry', 'social media',
];
// The remote-job indexes are full of AI rater and "expert" recruiting (Himalayas 2026-11-06: 9 of the 18 contract jobs open to the US)
const AI_VENDORS = /^(micro1|mercor|xperteez|innodata|welo global|imerit|outlier|dataannotation|alignerr|invisible|turing|telus|appen|scale ai|remotasks|toloka|prolific)\b/i;
const AI_TITLES = /\b(ai train\w*|ai tutor|annotat\w*|data label\w*|rater|search engine evaluator|bilingual expert)\b|expert, remote- contract/i;
const aiRecruiting = (company: string, title: string): boolean => AI_VENDORS.test(company) || AI_TITLES.test(title);
const US_OFFSETS = [-5, -6, -7, -8, -9, -10];

interface HzJob {
    guid: string; title: string; excerpt: string | null; description: string | null; companyName: string; employmentType: string;
    minSalary: number | null; maxSalary: number | null; salaryPeriod: string | null; currency: string | null;
    locationRestrictions?: string[] | null; timezoneRestrictions?: number[] | null; pubDate: number; expiryDate: number; applicationLink: string;
}

export function parseHimalayas(json: string): BoardPost[] {
    return (JSON.parse(json) as { jobs: HzJob[] }).jobs.map((j): BoardPost => {
        const places = j.locationRestrictions ?? [];
        const zones = j.timezoneRestrictions ?? [];
        const pay = j.minSalary || j.maxSalary
            ? `${j.currency ?? ''} ${[...new Set([j.minSalary, j.maxSalary].filter(Boolean))].join('–')} ${j.salaryPeriod ?? 'annual'}`.trim() : 'pay not listed';
        return {
            source: 'himalayas',
            sourceId: j.guid,
            sourceUrl: j.applicationLink, // their terms: every Apply button uses it unchanged
            title: j.title,
            content: `${j.employmentType.toLowerCase()}, ${pay}, ${places.length ? places.join(', ') : 'worldwide'}\n\n${text(j.description || j.excerpt)}`,
            author: j.companyName,
            subreddit: null,
            postedAt: new Date(j.pubDate * 1000).toISOString(), // "last updated"
            hint: [],
            drop: j.expiryDate * 1000 < Date.now() ? 'expired'
                : places.length && !places.includes('United States') ? `location ${places.join(', ')}`
                : zones.length && !zones.some((z) => US_OFFSETS.includes(z)) ? `time zones ${zones.join(', ')}`
                : aiRecruiting(j.companyName, j.title) ? 'AI-training recruiting'
                : undefined,
        };
    });
}

const himalayas: Board = {
    name: 'Himalayas',
    async list() {
        const posts = new Map<string, BoardPost>(); // one job can match several queries
        for (const q of HZ_QUERIES) {
            for (let page = 1; page <= 3; page++) { // country=US includes worldwide jobs
                const params = { q, employment_type: 'Contractor,Part Time,Temporary', country: 'US', sort: 'recent', page: String(page) };
                const batch = parseHimalayas(await get(`https://himalayas.app/jobs/api/search?${new URLSearchParams(params)}`, { Accept: 'application/json' }));
                batch.forEach((post) => posts.set(post.sourceId, post));
                if (batch.length < 20 || batch.some(older)) break; // mostly newest first: the next page is older still
            }
        }
        return [...posts.values()];
    },
};

// --- Jobicy: remote jobs, newest first over 7 days. Its API page (https://jobicy.com/jobs-rss-feed) allows job boards and
// subscription apps without asking: credit Jobicy and keep its job page as the Apply link. geo=usa includes "Anywhere".
interface JobicyJob {
    id: number; url: string; jobTitle: string; companyName: string; jobIndustry: string[]; jobType: string[]; jobGeo: string;
    jobExcerpt: string | null; jobDescription: string | null; pubDate: string;
    salaryMin?: number; salaryMax?: number; salaryCurrency?: string; salaryPeriod?: string;
}

export function parseJobicy(json: string): { posts: BoardPost[]; next: string | null } {
    const data = JSON.parse(json) as { jobs: JobicyJob[]; nextCursor: string | null };
    return {
        next: data.nextCursor,
        posts: data.jobs.map((j): BoardPost => {
            const type = j.jobType.join(', ') || 'not stated';
            const title = decode(j.jobTitle);
            const company = decode(j.companyName);
            const pay = j.salaryMin || j.salaryMax
                ? `${j.salaryCurrency ?? ''} ${[...new Set([j.salaryMin, j.salaryMax].filter(Boolean))].join('–')} ${j.salaryPeriod ?? ''}`.trim() : 'pay not listed';
            return {
                source: 'jobicy',
                sourceId: String(j.id),
                sourceUrl: j.url, // their terms: Apply goes to the Jobicy job page
                title,
                content: `${type}, ${pay}, ${j.jobIndustry.join(', ')}, ${j.jobGeo}\n\n${text(j.jobDescription || j.jobExcerpt)}`,
                author: company,
                subreddit: null,
                postedAt: iso(j.pubDate),
                hint: [],
                drop: !GIG_TYPE.test(type) ? `job type ${type}` : aiRecruiting(company, title) ? 'AI-training recruiting' : undefined,
            };
        }),
    };
}

const jobicy: Board = {
    name: 'Jobicy',
    async list() {
        const posts: BoardPost[] = [];
        let cursor: string | null = null;
        for (let page = 0; page < 6; page++) { // 100 US-open jobs were ~15 h on 2026-11-06, so 72 h is ~5 pages
            const params = new URLSearchParams({ count: '100', geo: 'usa', ...(cursor ? { cursor } : {}) });
            const { posts: batch, next } = parseJobicy(await get(`https://jobicy.com/api/jobs?${params}`, { Accept: 'application/json' }));
            posts.push(...batch);
            cursor = next;
            if (!cursor || !batch.length || older(batch[batch.length - 1])) break;
        }
        return posts;
    },
};

// --- We Work Remotely: one RSS feed per category, full text included. Its RSS page: "Anyone can use the feed, all we ask is
// that you attribute the links back to We Work Remotely." Mostly full-time: 10 of ~140 posts a week were contract (2026-11-06).
const WWR_FEEDS = ['design', 'full-stack-programming', 'front-end-programming', 'back-end-programming', 'devops-sysadmin',
    'customer-support', 'sales-and-marketing', 'product', 'management-and-finance'].map((c) => `remote-${c}-jobs`).concat('all-other-remote-jobs');

export function parseWeWorkRemotely(xml: string): BoardPost[] {
    return rssItems(xml).map((item): BoardPost => {
        const [company, ...role] = field(item, 'title').split(':');
        const title = role.join(':').trim() || company.trim();
        const type = field(item, 'type');
        const where = field(item, 'country') || field(item, 'region'); // a country list overrides "Anywhere in the World"
        const url = field(item, 'link');
        return {
            source: 'weworkremotely',
            sourceId: url.split('/').pop() || url,
            sourceUrl: url,
            title,
            content: `${type || 'type not stated'}, ${field(item, 'category')}, ${where}\n\n${text(field(item, 'description'))}`,
            author: role.length ? company.trim() : null,
            subreddit: null,
            postedAt: iso(field(item, 'pubDate')),
            hint: [],
            drop: !GIG_TYPE.test(type) ? `job type ${type || 'not stated'}`
                : !US_OR_ANYWHERE.test(where) ? `location ${where}`
                : aiRecruiting(company, title) ? 'AI-training recruiting'
                : undefined,
        };
    });
}

const weworkremotely: Board = {
    name: 'We Work Remotely',
    async list() {
        const posts: BoardPost[] = [];
        for (const feed of WWR_FEEDS) posts.push(...parseWeWorkRemotely(await get(`https://weworkremotely.com/categories/${feed}.rss`)));
        return posts;
    },
};

/** Himalayas' terms: closed jobs come off our board. Its job API answers 410 when closed, 404 when gone, 200 when open. */
export async function himalayasClosed(jobUrl: string): Promise<boolean> {
    const path = jobUrl.match(/^https:\/\/himalayas\.app\/companies\/([^/]+)\/jobs\/([^/?#]+)$/); // our source_id (the job's guid)
    if (!path) throw new Error(`not a Himalayas job URL: ${jobUrl}`);
    try {
        await get(`https://himalayas.app/jobs/api/companies/${path[1]}/jobs/${path[2]}`, { Accept: 'application/json' });
        return false;
    } catch (error) {
        if ([404, 410].includes((error as { status?: number }).status ?? 0)) return true;
        throw error;
    }
}

/** In fetch order: the professions the board needs most first (voice, writer, VA, audio). */
export const BOARDS: Record<Exclude<JobSource, 'reddit'>, Board> = {
    castingcall, ytjobs, hubstaff, workwithindies, blenderartists, wordpressjobs, problogger, careers, himalayas, jobicy, weworkremotely,
};
