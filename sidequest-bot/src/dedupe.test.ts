import assert from 'node:assert/strict';
import { test } from 'node:test';
import { duplicateKeys } from './dedupe.js';

const same = (a: Parameters<typeof duplicateKeys>[0], b: Parameters<typeof duplicateKeys>[0]) =>
    duplicateKeys(a).some((k) => duplicateKeys(b).includes(k));
const body = 'Looking for an illustrator for a 32 page picture book. Budget is $3,000 flat, paid in two milestones. '
    + 'Please send a portfolio with children\'s book work and your timeline. Final files are due before the end of November.';

test('cross-post with sub-specific tags and case is the same gig', () => {
    assert.ok(same(
        { author: 'Porumaru', title: '[HIRING] Persona-Style Portrait Artist', content: null },
        { author: 'porumaru', title: '[Paid] persona-style portrait artist!', content: null },
    ));
});

test('title reworded per sub, same body, same author', () => {
    assert.ok(same(
        { author: 'ykdworld', title: '[Hiring] Looking for artist to draw my OC!! ($100-$300)', content: body },
        { author: 'ykdworld', title: '[Hiring] Looking for artist to draw OC!! ($100-$300)', content: `${body} Thanks!` },
    ));
});

test('identical long text from several accounts collapses to one card', () => {
    assert.ok(same({ author: 'EvokerOfTeees', title: 'oc art', content: body }, { author: 'AxeAxer_', title: 'OC art', content: body }));
});

test('different gigs stay apart', () => {
    // same author, short generic body
    assert.ok(!same(
        { author: 'studio', title: '[Hiring] Character artist', content: 'DM me' },
        { author: 'studio', title: '[Hiring] Environment artist', content: 'DM me' },
    ));
    // same generic title, different people
    assert.ok(!same(
        { author: 'alice', title: '[Hiring] Video editor', content: null },
        { author: 'bob', title: '[Hiring] Video editor', content: null },
    ));
    // Discord: generic titles from one poster are not enough
    assert.ok(!duplicateKeys({ author: 'helena', title: 'Remote Jobs', content: 'Data entry, $20/h' }, false)
        .some((k) => duplicateKeys({ author: 'helena', title: 'Remote Jobs', content: 'Translator, $15/h' }, false).includes(k)));
    // deleted authors never match on title
    assert.ok(!same({ author: '[deleted]', title: 'Need a logo designer', content: null }, { author: '[deleted]', title: 'Need a logo designer', content: null }));
});
