import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    BOARDS, CLOSED_CHECKS, blenderArtistsClosed, castingCallClosed, himalayasClosed, iso, ytJobClosed, parseCareers, parseCastingCall, parseHimalayas, parseHubstaff, parseJobicy, parseProblogger, parseWeWorkRemotely, parseWordpressJobs, parseWorkWithIndies, parseYtFeed, parseYtJob, text,
} from './boards.js';
import { isNsfwContent } from '../filters.js';

// Trimmed copies of what each board answered on 2026-11-05.

test('Casting Call Club: paid roles map to professions; roleplay and on-camera-only projects drop', () => {
    const project = (projectId: number, category: string, roles: object[]) => ({
        project: { projectId, slug: `p${projectId}`, name: 'audiobook narrator wanted', category, listedAt: '2026-11-05T14:37:28.025Z', description: 'cozy fantasy<br>9 hours', username: 'riag' },
        roles,
    });
    const voice = { isA: 'voice_actor', kind: 'voice actor', payment: 'paid', paymentTotal: '$900 CAD', paymentInterval: 'Flat Rate' };
    const [ok, roleplay, onCamera] = parseCastingCall(JSON.stringify({ results: [
        project(1, 'videogame', [voice, { isA: 'music_composer', kind: 'musician', payment: 'paid' }]),
        project(2, 'roleplay', [voice]),
        project(3, 'film', [{ isA: 'live_actor', kind: 'actor', payment: 'paid' }]),
    ] }));
    assert.deepEqual(ok.hint, ['voice-actor', 'audio']);
    assert.equal(ok.drop, undefined);
    assert.equal(ok.sourceUrl, 'https://www.castingcall.club/projects/p1');
    assert.equal(ok.content, 'voice actor: $900 CAD, flat rate; musician: paid\n\ncozy fantasy\n9 hours');
    assert.equal(roleplay.drop, 'roleplay project');
    assert.equal(onCamera.drop, 'no paid role with a profession here');
});

test('YT Jobs: feed gives id and time; full-time and non-editing roles drop', () => {
    const [post] = parseYtFeed('<rss><channel><item><title>Video Editor</title><link>https://ytjobs.co/job/46291</link>'
        + '<author>Josh</author><pubDate>Thu, 05 Nov 2026 10:00:00 +0000</pubDate></item></channel></rss>');
    assert.equal(post.sourceId, '46291');
    assert.equal(post.postedAt, '2026-11-05T10:00:00.000Z');
    const job = (jobType: string, functionalArea: string) => parseYtJob(JSON.stringify({
        jobTitle: 'Video Editor', jobType, functionalArea, status: 'active', minSalary: 400, maxSalary: 700,
        description: 'Edit 2 videos a week', htmlContent: null, locationType: 'Remote', company: { name: 'Josh', abvSubscribers: '979K' },
    }), post);
    const perProject = job('1', '1');
    assert.deepEqual(perProject.hint, ['video-editor']);
    assert.equal(perProject.drop, undefined);
    assert.equal(perProject.content, 'per project, $400–$700, Josh (979K subscribers)\n\nEdit 2 videos a week');
    assert.equal(job('3', '1').drop, 'full-time');
    assert.equal(job('5', '6').drop, undefined); // a channel manager may still be a VA gig: the AI decides
    assert.deepEqual(job('5', '6').hint, []);
});

test('Hubstaff: cards come out of the escaped JS; full time drops; times are UTC', () => {
    const card = (slug: string, label: string) => '<div class=\\"search-result\\"><div class=\\"main-details\\">'
        + `<a class=\\"name margin-right-10\\" rel=\\"nofollow\\" href=\\"\\/jobs\\/${slug}\\">Kajabi Specialist &amp; VA<\\/a>`
        + `<span class=\\"label label-${label} margin-left-5\\">x<\\/span><div class=\\"pay-rate\\">\\$500<\\/div>`
        + '<a class=\\"is-inline-block job-agency margin-right-20\\" href=\\"https:\\/\\/x.com\\/\\"><i class=\\"hi hi-agency\\" title=\\"Client\\"><\\/i> MeetYourVA<\\/a>'
        + '<span class=\\"location\\"><i class=\\"hi hi-pin\\"><\\/i> <strong>HQ:<\\/strong> New York, United States<\\/span>'
        + '<span class=\\"a-tooltip\\" data-original-title=\\"November  5, 2026 at  1:23 pm\\">2 hrs ago<\\/span>'
        + '<div class=\\"profil-bio push-bottom-10\\">Build email campaigns in Kajabi...<\\/div><\\/div><\\/div>';
    const [fixed, fullTime] = parseHubstaff(`$('#results').html("${card('kajabi-specialist', 'fixed_price')}${card('python-engineer', 'full_time')}");`);
    assert.equal(fixed.sourceUrl, 'https://hubstafftalent.net/jobs/kajabi-specialist');
    assert.equal(fixed.title, 'Kajabi Specialist & VA');
    assert.equal(fixed.author, 'MeetYourVA');
    assert.equal(fixed.postedAt, '2026-11-05T13:23:00.000Z');
    assert.equal(fixed.content, 'fixed price, $500, company HQ New York, United States\n\nBuild email campaigns in Kajabi...');
    assert.equal(fixed.drop, undefined);
    assert.equal(fullTime.drop, 'full-time');
});

test('Work With Indies: keeps contract work open to US users; the AI picks the profession when tags give none', () => {
    const item = (title: string, tags: string) => `<item><title>${title}</title><link>https://www.workwithindies.com/careers/${title.length}</link>`
        + `<description>Make things. Tags: ${tags}</description><pubDate>Wed, 04 Nov 2026 00:00:00 GMT</pubDate></item>`;
    const [ok, fullTime, design, copenhagen, eastern, graphic] = parseWorkWithIndies(`<rss>${[
        item('Fawkes is hiring an Environment Artist to work from Anywhere', '[Art &amp; Animation] [Contract]'),
        item('Big is hiring a Programmer to work from Anywhere', '[Programming] [Full Time]'),
        item('Fawkes is hiring a Game Designer to work from Anywhere', '[Design] [Contract]'),
        item('Tiny is hiring a Composer to work from Copenhagen, DK', '[Audio] [Freelance]'),
        item('Tiny is hiring a QA Tester to work from ET ± 3 hours', '[QA &amp; CS] [Part Time]'),
        item('Albedo is hiring a Graphic Designer to work from Anywhere', '[Marketing &amp; Community] [Contract]'),
    ].join('')}</rss>`);
    assert.equal(ok.title, 'Environment Artist at Fawkes');
    assert.deepEqual(ok.hint, ['artist']);
    assert.equal(ok.drop, undefined);
    assert.equal(ok.content, 'Art & Animation, Contract; work from Anywhere\n\nMake things.');
    assert.equal(fullTime.drop, 'full-time');
    assert.equal(design.drop, undefined);
    assert.deepEqual(design.hint, []);
    assert.equal(copenhagen.drop, 'location Copenhagen, DK');
    assert.equal(eastern.drop, undefined);
    assert.deepEqual(graphic.hint, ['artist']);
});

test('jobs.wordpress.net and ProBlogger: staff roles and employee job types drop', () => {
    const wp = parseWordpressJobs('<rss><item><title>WordPress &amp; WooCommerce Developer – Project-Based</title>'
        + '<link>https://jobs.wordpress.net/job/a/</link><pubDate>Tue, 03 Nov 2026 14:18:02 +0000</pubDate>'
        + '<content:encoded><![CDATA[<p>Build a store.</p><ul><li>Checkout</li></ul>]]></content:encoded><post-id xmlns="x">64922</post-id></item>'
        + '<item><title>Freelance – Full-Time Dedicated</title><link>https://jobs.wordpress.net/job/b/</link></item></rss>');
    assert.equal(wp[0].title, 'WordPress & WooCommerce Developer – Project-Based');
    assert.equal(wp[0].sourceId, '64922');
    assert.equal(wp[0].content, 'Build a store.\n- Checkout');
    assert.equal(wp[0].drop, undefined);
    assert.equal(wp[1].drop, 'staff role');

    const row = (type: string, slug: string) => `<div class="wpjb-grid-row wpjb-click-area wpjb-type-${type} wpjb-category-blog">`
        + `<a href="https://problogger.com/jobs/job/${slug}/">True Crime Script Writer</a><span class="wpjb-sub wpjb-sub-small">Solas Media</span></div>`;
    const [freelance, partTime] = parseProblogger(`<div class="wpjb-job-list">${row('freelance', 'a')}${row('part-time', 'b')}</div>`);
    assert.equal(freelance.sourceUrl, 'https://problogger.com/jobs/job/a/');
    assert.equal(freelance.author, 'Solas Media');
    assert.equal(freelance.drop, undefined);
    assert.equal(partTime.drop, 'job type part-time');
});

test('text() turns HTML into readable lines', () => {
    assert.equal(text('<p>Hi&nbsp;there</p><p>Pay: &#36;50 &ndash; flat</p><br>Done'), 'Hi there\nPay: $50 – flat\n\nDone');
});

test('career pages: each job-board software maps to one shape; only gig types are kept', () => {
    const [reporter, staff] = parseCareers('lever', 'ion', 'ION Group', JSON.stringify([
        { id: 'a1', text: 'Freelance Reporter', hostedUrl: 'https://jobs.lever.co/ion/a1', createdAt: Date.UTC(2026, 10, 4), workplaceType: 'remote',
            categories: { commitment: 'Journalist Contractor', location: 'Remote US' }, descriptionPlain: 'Cover AI law.', lists: [{ text: 'You have', content: '<li>Bylines</li>' }] },
        { id: 'a2', text: 'Tech Lead', hostedUrl: 'https://jobs.lever.co/ion/a2', createdAt: 0, categories: { commitment: 'Full-time' } },
    ]));
    assert.equal(reporter.sourceId, 'lever:ion:a1');
    assert.equal(reporter.author, 'ION Group');
    assert.equal(reporter.postedAt, '2026-11-04T00:00:00.000Z');
    assert.equal(reporter.content, 'Journalist Contractor, Remote US, remote\n\nCover AI law.\n\nYou have\n- Bylines');
    assert.equal(reporter.drop, undefined);
    assert.equal(staff.drop, 'job type Full-time');

    const [writer, engineer] = parseCareers('greenhouse', 'straightarrownews', 'Straight Arrow News', JSON.stringify({ jobs: [
        { id: 1, title: 'Freelance Writer', absolute_url: 'https://g/1', updated_at: '2026-11-05T00:00:00Z', location: { name: 'Remote' }, content: '&lt;p&gt;Local stories&lt;/p&gt;' },
        { id: 2, title: 'Software Engineer', absolute_url: 'https://g/2', updated_at: '2026-11-05T00:00:00Z', content: '' },
    ] }));
    assert.equal(writer.content, 'freelance or contract (title), Remote\n\nLocal stories');
    assert.equal(engineer.drop, 'job type not stated');

    const [partTime] = parseCareers('ashby', 'intro', 'Intro', JSON.stringify({ jobs: [{ id: 'x', title: 'Video Editor', jobUrl: 'https://a/x',
        employmentType: 'PartTime', location: 'Los Angeles', isRemote: true, publishedAt: '2026-11-05T00:00:00Z', compensation: { compensationTierSummary: '$40/hr' } }] }));
    assert.equal(partTime.content, 'PartTime, Los Angeles, remote, $40/hr');
    assert.equal(partTime.drop, undefined);

    const [contract] = parseCareers('breezy', 'compose-ly', 'Compose.ly', JSON.stringify([{ id: 'b', name: 'Technical Writer', url: 'https://compose-ly.breezy.hr/p/b',
        published_date: '2026-10-28T00:00:00Z', type: { name: 'Contract' }, location: { name: 'United States', is_remote: true }, salary: '$30 – $40 / hour' }]));
    assert.equal(contract.content, 'Contract, United States, remote, $30 – $40 / hour');
});

test('Himalayas: open to the US or worldwide, not AI-training recruiting, apply link unchanged', () => {
    const job = (over: object) => ({
        guid: 'https://himalayas.app/companies/collider/jobs/list-writer', title: 'Movie List Writer', excerpt: 'Write lists', description: '<p>Write <b>lists</b></p>',
        companyName: 'Collider', employmentType: 'Contractor', minSalary: 35, maxSalary: 40, salaryPeriod: 'hourly', currency: 'USD',
        locationRestrictions: [], timezoneRestrictions: [-8, -5], pubDate: 1793910128, expiryDate: 4102444800,
        applicationLink: 'https://himalayas.app/companies/collider/jobs/list-writer?utm_source=x', ...over,
    });
    const [ok, india, asia, vendor, title, expired, yo] = parseHimalayas(JSON.stringify({ jobs: [
        job({}), job({ locationRestrictions: ['India', 'Mexico'] }), job({ timezoneRestrictions: [5, 8] }),
        job({ companyName: 'micro1' }), job({ title: 'Audio Engineer - AI Trainer' }), job({ expiryDate: 1 }),
        job({ companyName: 'YO AI Labs', title: 'Krita Expert - Remote' }),
    ] }));
    assert.equal(ok.sourceUrl, 'https://himalayas.app/companies/collider/jobs/list-writer?utm_source=x');
    assert.equal(ok.content, 'contractor, USD 35–40 hourly, worldwide\n\nWrite lists');
    assert.equal(ok.drop, undefined);
    assert.equal(india.drop, 'location India, Mexico');
    assert.equal(asia.drop, 'time zones 5, 8');
    assert.equal(vendor.drop, 'AI-training recruiting');
    assert.equal(title.drop, 'AI-training recruiting');
    assert.equal(expired.drop, 'expired');
    assert.equal(yo.drop, 'AI-training recruiting');
});

test('Jobicy: gig types only, not AI-training recruiting; Apply stays on Jobicy; the cursor is passed on', () => {
    const job = (over: object) => ({
        id: 1, url: 'https://jobicy.com/jobs/1-grant-writer', jobTitle: 'Grant Writer', companyName: 'Code&#038;Path', jobIndustry: ['Content & Editorial'],
        jobType: ['Contract'], jobGeo: 'USA', jobExcerpt: 'Write grants', jobDescription: '<p>Write <b>grants</b></p>', pubDate: '2026-11-04T10:00:00+00:00',
        salaryMin: 40, salaryMax: 50, salaryCurrency: 'USD', salaryPeriod: 'hourly', ...over,
    });
    const { posts: [ok, fullTime, trainer, vendor], next } = parseJobicy(JSON.stringify({ nextCursor: 'abc', jobs: [
        job({}), job({ jobType: ['Full-Time'] }), job({ jobTitle: 'AI Trainers Network - English (United States)' }), job({ companyName: 'Welo Global' }),
    ] }));
    assert.equal(next, 'abc');
    assert.equal(ok.sourceUrl, 'https://jobicy.com/jobs/1-grant-writer');
    assert.equal(ok.author, 'Code&Path');
    assert.equal(ok.postedAt, '2026-11-04T10:00:00.000Z');
    assert.equal(ok.content, 'Contract, USD 40–50 hourly, Content & Editorial, USA\n\nWrite grants');
    assert.equal(ok.drop, undefined);
    assert.equal(fullTime.drop, 'job type Full-Time');
    assert.equal(trainer.drop, 'AI-training recruiting');
    assert.equal(vendor.drop, 'AI-training recruiting');
});

test('We Work Remotely: contract posts open to the US; a country list overrides "Anywhere in the World"', () => {
    const item = (title: string, type: string, region: string, country = '') => `<item><title>${title}</title><region>${region}</region>`
        + `<country>${country}</country><category>Design</category><type>${type}</type>`
        + '<description>&lt;p&gt;&lt;strong&gt;Headquarters:&lt;/strong&gt; Austin&lt;/p&gt;&lt;p&gt;Design &amp;amp; build&lt;/p&gt;</description>'
        + `<pubDate>Thu, 05 Nov 2026 18:00:00 +0000</pubDate><link>https://weworkremotely.com/remote-jobs/${title.length}-x</link></item>`;
    const [ok, fullTime, serbia, us] = parseWeWorkRemotely(`<rss>${[
        item('Breakthrough Design Group: Senior Creative &amp; Web Designer', 'Contract', 'Anywhere in the World'),
        item('Big Co: Engineer', 'Full-Time', 'Anywhere in the World'),
        item('Wolt - English: Support Associate', 'Contract', 'Anywhere in the World', '🇷🇸 Serbia'),
        item('Ninja Partners LLC: Customer Service Representative II', 'Contract', 'Texas', '🇺🇸 United States of America'),
    ].join('')}</rss>`);
    assert.equal(ok.title, 'Senior Creative & Web Designer');
    assert.equal(ok.author, 'Breakthrough Design Group');
    assert.equal(ok.sourceId, '61-x'); // the link's last segment
    assert.equal(ok.postedAt, '2026-11-05T18:00:00.000Z');
    assert.equal(ok.content, 'Contract, Design, Anywhere in the World\n\nHeadquarters: Austin\nDesign & build');
    assert.equal(ok.drop, undefined);
    assert.equal(fullTime.drop, 'job type Full-Time');
    assert.equal(serbia.drop, 'location 🇷🇸 Serbia');
    assert.equal(us.drop, undefined);
});

test('posted dates: one UTC format for every board, null when there is none', () => {
    assert.equal(iso('2026-11-04T10:00:00-04:00'), '2026-11-04T14:00:00.000Z'); // Greenhouse
    assert.equal(iso('2026-11-05T14:37:28.025Z'), '2026-11-05T14:37:28.025Z');
    assert.equal(iso('Thu, 05 Nov 2026 10:00:00 +0000'), '2026-11-05T10:00:00.000Z');
    assert.equal(iso(null), null);
    assert.equal(iso('Oct, 29 at noon-ish'), null);
});

test('Himalayas sweep: 410 and 404 are closed, 200 is open, anything else is no answer', async () => {
    const real = globalThis.fetch;
    const asked: string[] = [];
    try {
        for (const [status, closed] of [[410, true], [404, true], [200, false], [503, null]] as const) {
            globalThis.fetch = (async (url: string) => { asked.push(url); return new Response('{}', { status }); }) as typeof fetch;
            const job = 'https://himalayas.app/companies/comic-book-resources-cbr/jobs/movieweb-news-writer-film-and-tv';
            if (closed === null) await assert.rejects(himalayasClosed(job), /HTTP 503/);
            else assert.equal(await himalayasClosed(job), closed);
        }
    } finally {
        globalThis.fetch = real;
    }
    assert.equal(asked[0], 'https://himalayas.app/jobs/api/companies/comic-book-resources-cbr/jobs/movieweb-news-writer-film-and-tv');
    await assert.rejects(himalayasClosed('https://example.com/jobs/1'), /not a Himalayas job URL/);
});

test('NSFW filter catches the spelled-out "Not Safe For Work - Mature Content" (a Casting Call Club title); plain "mature" stays', () => {
    assert.equal(isNsfwContent('Not Safe For Work - Mature Content', 'voice actor: $20 USD, flat rate'), true);
    assert.equal(isNsfwContent('Indie game VA', 'This project contains mature content.'), true);
    assert.equal(isNsfwContent('Mature narrator voice wanted', 'calm, mature tone for an audiobook'), false);
});

test('closed-job checks: YT Jobs status, Casting Call Club gate and deadlines, Blender Artists thread, page 404s; other failures are no answer', async () => {
    const real = globalThis.fetch;
    const reply = (body: string, status = 200) => { globalThis.fetch = (async () => new Response(body, { status })) as unknown as typeof fetch; };
    const role = (validThrough?: string) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Narrator', description: 'x', validThrough })}</script>`;
    const now = Date.parse('2026-11-07T00:00:00Z');
    try {
        reply('{"status":"active"}'); assert.equal(await ytJobClosed('46348'), false);
        reply('{"status":"closed"}'); assert.equal(await ytJobClosed('46348'), true);
        reply('{}', 404); assert.equal(await ytJobClosed('46348'), true);
        reply('{"job":{}}'); await assert.rejects(ytJobClosed('46348'), /no status/); // shape changed: never read as closed

        const url = 'https://www.castingcall.club/projects/p1';
        reply('<title>Not Safe For Work - Mature Content | Casting Call Club</title>'); assert.equal(await castingCallClosed(url, now), true);
        reply(role('2026-11-01T12:00:00-08:00') + role('2026-11-02T00:00:00Z')); assert.equal(await castingCallClosed(url, now), true);
        reply(role('2026-11-01T12:00:00-08:00') + role('2026-12-01T00:00:00Z')); assert.equal(await castingCallClosed(url, now), false); // one role still open
        reply(role()); assert.equal(await castingCallClosed(url, now), false); // no deadline given
        reply('<html>redesigned</html>'); await assert.rejects(castingCallClosed(url, now), /no roles/);
        reply('<title>Not Safe For Work - Mature Content | Casting Call Club</title><meta property="og:title" content="Not Safe For Work - Mature Content">');
        const gated = await BOARDS.castingcall.detail!({ source: 'castingcall', sourceId: 'p1', sourceUrl: url, title: 'lovesick game jam', content: 'voice actor' } as never);
        assert.equal(gated.drop, 'NSFW or 18+ (Casting Call Club age gate)'); // the gate's title is never taken as the job's

        reply('{"closed":true}'); assert.equal(await blenderArtistsClosed('1234'), true);
        reply('{"closed":false,"archived":false}'); assert.equal(await blenderArtistsClosed('1234'), false);

        const page = { sourceId: '1', sourceUrl: 'https://jobs.wordpress.net/job/x/' };
        reply('', 404); assert.equal(await CLOSED_CHECKS.wordpressjobs!(page), true);
        reply('<html>'); assert.equal(await CLOSED_CHECKS.wordpressjobs!(page), false);
        reply('', 403); await assert.rejects(CLOSED_CHECKS.jobicy!(page), /HTTP 403/);
        assert.equal(CLOSED_CHECKS.hubstaff, undefined); // 403 for a missing job: can't tell
        assert.equal(CLOSED_CHECKS.weworkremotely, undefined);
    } finally {
        globalThis.fetch = real;
    }
});

test('feed rules: full-time or on-site VA jobs go, a VA side tag goes, junk titles get the AI title', async () => {
    const { withoutEmployeeVA, junkTitle } = await import('../ai/scorer.js');
    const s = (professions: string[]) => ({ isJob: true, professions, score: 8, matchScore: 80, confidence: 1, summary: '', analysis: {} as never, method: 'ai' as const, reason: '' }) as never;
    assert.equal(withoutEmployeeVA(s(['virtual-assistant']), 'Executive Assistant. Job Type: Full-time. Salary: $1.3K/month').score, 1);
    assert.equal(withoutEmployeeVA(s(['virtual-assistant']), 'Hiring an on-site Executive Assistant').score, 1);
    assert.equal(withoutEmployeeVA(s(['virtual-assistant']), 'Property manager VA, part time to full time hours available, $8-10/hr').score, 8);
    assert.deepEqual((withoutEmployeeVA(s(['video-editor', 'virtual-assistant']), 'Full-time video editor and assistant') as { professions: string[] }).professions, ['video-editor']);
    for (const t of ['Hiring', 'Help 🥹', '[Hiring] $50 Budget', 'Eureka', "I'm hiring, someone interested??"]) assert.ok(junkTitle(t), t);
    for (const t of ['[Hiring] cold caller', 'DUSK - A Supernatural Mystery', '𝗤𝘂𝗮𝗹𝗶𝘁𝘆 𝗔𝘀𝘀𝘂𝗿𝗮𝗻𝗰𝗲 𝗘𝗻𝗴𝗶𝗻𝗲𝗲𝗿']) assert.ok(!junkTitle(t), t);
});
