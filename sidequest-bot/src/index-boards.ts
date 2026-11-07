#!/usr/bin/env node
/**
 * Public job boards (sources/boards.ts) -> the main DB, next to Reddit. Laptop cron: job-fetcher
 * scripts/domain/run_boards_scraper.sh. Plan and rollout: job-fetcher docs/handoff-new-job-sources-2026-11-05.md.
 *
 * A board is a dry run (fetch, filter and score, store nothing) until it is named in BOARDS_LIVE (comma list).
 * Every post looked at goes to BOARDS_LOG (JSONL) with the decision and why. The log is also the memory of what
 * was seen, so each post is fetched in detail and scored once.
 *   node dist/index-boards.js            one run
 *   node dist/index-boards.js --report   per board: gigs per day and profession, how many scored 7+, recent gigs
 */
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { scoreJob } from './ai/scorer.js';
import { duplicateKeys } from './dedupe.js';
import { isNsfwContent } from './filters.js';
import { initDb, insertJob, jobExists, markRemoved, recentJobKeys, shownJobs } from './db/turso.js';
import { BOARDS, MAX_AGE_MS, himalayasClosed, iso, type BoardPost } from './sources/boards.js';

const LOG = process.env.BOARDS_LOG || 'boards-log.jsonl';
const LIVE = new Set((process.env.BOARDS_LIVE || '').split(',').map((s) => s.trim()).filter(Boolean));
const MIN_SCORE = 4; // same bar as Reddit, X and Discord
// Unambiguous scam and noise wording from the 2026-11-05 research; the scorer's board rules catch the rest.
// Not "AI training" ("No AI training or voice cloning" is a normal casting line) or "appointment setting" (a VA task).
const SCAM = /uncapped commission|commission[- ]only|bilingual expert|paid after (a |the )?\d+[- ]day trial|surroga(te|cy)|payment tester/i;

interface Entry {
    at: string;
    source: string;
    id: string;
    url: string;
    title: string;
    postedAt: string | null;
    decision: 'drop' | 'reject' | 'accept' | 'insert';
    reason: string;
    professions?: string[];
    score?: number;
    summary?: string;
    budget?: string | null;
}

function readLog(): Entry[] {
    if (!existsSync(LOG)) return [];
    return readFileSync(LOG, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line) as Entry]; } catch { return []; } // a torn last line from a killed run
    });
}

const age = (post: BoardPost): number => (post.postedAt ? Date.now() - Date.parse(post.postedAt) : 0);
// The board keeps the full text; we keep the start of it and link to the original (handoff section 7.4).
const clip = (s: string | null, n = 1000): string | null => (s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

// The wrapper kills the run at 20 min (run_boards_scraper.sh, timeout 1200): the sweep stops checking at 16 min.
const SWEEP_UNTIL = Date.now() + 16 * 60_000;

// Himalayas' terms: remove jobs once they close (they can close before expiryDate). Runs after the boards so it can't
// starve them, checks rows in random order until SWEEP_UNTIL (one request each, 1.5 s apart: ~600 rows after 30 days
// at ~20 a day is ~15 min), so every row still gets checked every few runs once there are more than one run can do.
async function sweepHimalayas(): Promise<void> {
    const rows = await shownJobs('himalayas');
    const closed: string[] = [];
    let checked = 0;
    let unanswered = 0;
    for (const row of rows) {
        if (Date.now() > SWEEP_UNTIL) break;
        checked++;
        try {
            if (await himalayasClosed(row.sourceId)) closed.push(row.id);
        } catch (error) {
            unanswered++;
            console.error(`[boards]    ⚠️ himalayas sweep ${row.sourceId}: ${error instanceof Error ? error.message : error}`);
        }
    }
    // Every job closed at once is more likely their API changing than real closures: hide nothing, alert.
    if (closed.length >= 5 && closed.length === checked) throw new Error(`all ${checked} Himalayas jobs checked read as closed; nothing hidden`);
    for (const id of closed) await markRemoved(id);
    console.log(`[boards] himalayas sweep: ${rows.length} shown, ${checked} checked, ${closed.length} closed and removed, ${unanswered} unanswered`);
    if (checked && unanswered === checked) throw new Error('no Himalayas job answered');
}

async function run(): Promise<void> {
    const unknown = [...LIVE].filter((s) => !(s in BOARDS));
    if (unknown.length) throw new Error(`BOARDS_LIVE has unknown boards: ${unknown.join(', ')} (known: ${Object.keys(BOARDS).join(', ')})`);
    if (LIVE.size) await initDb();
    const seen = new Set(readLog().map((e) => `${e.source}:${e.id}`));
    const failed: string[] = [];

    for (const [source, board] of Object.entries(BOARDS)) {
        const live = LIVE.has(source);
        const counts = { drop: 0, reject: 0, accept: 0, insert: 0 };
        const log = (post: BoardPost, decision: Entry['decision'], reason: string, scored: Partial<Entry> = {}) => {
            const entry: Entry = {
                at: new Date().toISOString(), source, id: post.sourceId, url: post.sourceUrl, title: post.title,
                postedAt: post.postedAt, decision, reason, ...scored,
            };
            appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
            seen.add(`${source}:${post.sourceId}`);
            counts[decision]++;
        };

        let posts: BoardPost[];
        try {
            posts = await board.list();
            if (posts.length === 0) throw new Error('the page parsed to 0 posts (layout change?)');
        } catch (error) {
            failed.push(source);
            console.error(`[boards] ❌ ${source}: ${error instanceof Error ? error.message : error}`);
            continue;
        }
        const stored = live ? await recentJobKeys(source) : new Set<string>();

        for (let post of posts) {
            if (seen.has(`${source}:${post.sourceId}`) || age(post) > MAX_AGE_MS) continue;
            if (!post.drop && board.detail) {
                try {
                    post = { ...post, ...(await board.detail(post)) };
                } catch (error) {
                    console.error(`[boards]    ⚠️ ${post.sourceUrl}: ${error instanceof Error ? error.message : error} (next run retries)`);
                    continue;
                }
            }
            post = { ...post, postedAt: iso(post.postedAt) }; // boards give offsets, other formats or nothing
            const scam = `${post.title}\n${post.content ?? ''}`.match(SCAM)?.[0];
            const drop = post.drop
                || (age(post) > MAX_AGE_MS && 'older than 72 h')
                // Not Reddit's junk patterns: casting calls link their Discord server
                || (isNsfwContent(post.title, post.content) && 'NSFW or 18+')
                || (scam && `scam wording "${scam}"`)
                || (live && ((await jobExists(source, post.sourceId)) || duplicateKeys(post).some((k) => stored.has(k))) && 'copy of a stored job');
            if (drop) {
                log(post, 'drop', drop);
                continue;
            }

            const scored = await scoreJob(post, board.name);
            if (scored.method !== 'ai') {
                console.warn(`[boards]    ⚠️ AI scoring failed, next run retries: ${post.title.slice(0, 60)}`);
                continue;
            }
            const professions = post.hint.length ? post.hint : scored.professions;
            const result = { professions, score: scored.score, summary: scored.summary, budget: scored.analysis.budget_signal };
            const ok = scored.isJob && !scored.notSideQuest && professions.length > 0 && scored.score >= MIN_SCORE;
            const reason = scored.notSideQuest ? `not a side quest: ${scored.notSideQuest}` : scored.reason;
            console.log(`[boards]    ${ok ? '✅' : '❌'} ${scored.score}/10 [${professions.join(',')}] ${post.title.slice(0, 60)} (${reason})`);
            if (!ok) {
                log(post, 'reject', reason, result);
                continue;
            }
            if (live) {
                await insertJob({ ...post, content: clip(post.content) }, professions, scored.score, scored.summary, scored.analysis, scored.matchScore);
                duplicateKeys(post).forEach((k) => stored.add(k));
            }
            log(post, live ? 'insert' : 'accept', scored.reason, result);
        }
        console.log(`[boards] ${source}${live ? '' : ' (dry run)'}: ${posts.length} listed, ${counts.drop} dropped, `
            + `${counts.reject} rejected by the AI, ${counts.insert + counts.accept} ${live ? 'stored' : 'would be stored'}`);
    }
    if (LIVE.size) {
        try {
            await sweepHimalayas();
        } catch (error) {
            failed.push('himalayas sweep');
            console.error(`[boards] ❌ himalayas sweep: ${error instanceof Error ? error.message : error}`);
        }
    }
    if (failed.length) throw new Error(`boards failed: ${failed.join(', ')}`);
}

function report(): void {
    const entries = readLog();
    const now = Date.now();
    for (const source of Object.keys(BOARDS)) {
        const mine = entries.filter((e) => e.source === source);
        if (!mine.length) {
            console.log(`\n${source}: nothing logged yet`);
            continue;
        }
        const since = Date.parse(mine[0].at);
        const elapsed = (now - since) / 86_400_000;
        const days = Math.max(elapsed, 1); // under a day, a single gig would read as many per day
        const gigs = mine.filter((e) => e.decision === 'accept' || e.decision === 'insert');
        const count = (keys: string[]) => Object.entries(keys.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {}))
            .sort((a, b) => b[1] - a[1]);
        // The first run also logs up to 72 h of older posts, so the daily rate counts only posts made since then.
        const perDay = count(gigs.filter((e) => !e.postedAt || Date.parse(e.postedAt) >= since).flatMap((e) => e.professions ?? []))
            .map(([p, n]) => `${p} ${(n / days).toFixed(1)}`).join(', ');
        const drops = count(mine.filter((e) => e.decision === 'drop').map((e) => e.reason.slice(0, 40)))
            .slice(0, 6).map(([r, n]) => `${r} ${n}`).join('; ');
        console.log(`\n${source}: ${elapsed.toFixed(1)} days logged, ${mine.length} posts looked at, ${gigs.length} gigs `
            + `(${gigs.filter((e) => (e.score ?? 0) >= 7).length} scored 7+), ${mine.filter((e) => e.decision === 'reject').length} rejected by the AI`);
        console.log(`   gigs per day: ${perDay || 'none'}`);
        console.log(`   dropped: ${drops || 'none'}`);
        for (const e of gigs.filter((g) => now - Date.parse(g.at) < 2 * 86_400_000)) {
            console.log(`   ${e.score}/10 [${(e.professions ?? []).join(',')}] ${e.title.slice(0, 70)}  ${e.url}`);
        }
    }
}

if (process.argv.includes('--report')) {
    report();
} else {
    run().then(
        () => process.exit(0),
        (error) => {
            console.error(`[boards] ❌ ${error instanceof Error ? error.message : error}`);
            process.exit(1);
        },
    );
}
