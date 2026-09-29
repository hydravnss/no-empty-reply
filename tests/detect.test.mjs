import assert from 'node:assert/strict';
import { isEmptyReply, stripNoise, countAlnum, parseCustomRegexes } from '../detect.js';

const opts = { minChars: 2 };
const empty = s => isEmptyReply(s, opts).empty;

// Doivent être considérés comme vides
for (const s of ['.', '', ' . ', '…', '*', '-', '  ', '\n\n', '***', '_.._', '~~', '`', '\u200B', '\uFEFF.\u200B', '*...*', '—', '!?', undefined, null, 'a']) {
    assert.equal(empty(s), true, `devrait être vide : ${JSON.stringify(s)}`);
}
// Doivent passer
for (const s of ['Bonjour', 'Ok', 'ok', '*sourit*', '_hm ok_', 'Éé', '日本', '42', '*Elle sourit.*', 'Oui.']) {
    assert.equal(empty(s), false, `devrait passer : ${JSON.stringify(s)}`);
}
// minChars 3 : "ok" (2 lettres) est vide
assert.equal(isEmptyReply('ok', { minChars: 3 }).empty, true);
assert.equal(isEmptyReply('oui', { minChars: 3 }).empty, false);
// minChars plancher à 1 : "." reste vide même avec 0
assert.equal(isEmptyReply('.', { minChars: 0 }).empty, true);
assert.equal(isEmptyReply('a', { minChars: 0 }).empty, false);
// helpers
assert.equal(stripNoise('*sourit*'), 'sourit');
assert.equal(countAlnum('é1-x'), 3);
// regex personnalisées
assert.equal(isEmptyReply('Je ne peux pas répondre', { minChars: 2, customRegex: '/^je ne peux pas/i' }).empty, true);
assert.equal(isEmptyReply('N/A', { minChars: 2, customRegex: 'n/a' }).empty, true);
assert.equal(isEmptyReply('Bonjour', { minChars: 2, customRegex: '(invalide\n/^ok$/' }).empty, false);
assert.equal(parseCustomRegexes('(\n\nabc\n/x/g').length, 2);

console.log('OK : tous les tests de détection passent');
