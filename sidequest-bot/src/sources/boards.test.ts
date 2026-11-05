import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    parseCastingCall, parseHubstaff, parseProblogger, parseWordpressJobs, parseWorkWithIndies, parseYtFeed, parseYtJob, text,
} from './boards.js';

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
    assert.match(job('5', '6').drop ?? '', /^role area 6/);
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

test('Work With Indies: keeps contract work open to US users with a profession we list', () => {
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
    assert.match(design.drop ?? '', /no profession here/);
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
