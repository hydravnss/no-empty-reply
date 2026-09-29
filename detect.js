/**
 * No Empty Reply - logique de détection (pur JS, sans dépendance à SillyTavern).
 * Isolée dans ce fichier pour pouvoir être testée sous Node.
 */

// Caractères invisibles : espaces de largeur nulle, BOM, soft hyphen, marques directionnelles, etc.
const INVISIBLE_RE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]|\p{Cf}|\p{Cc}/gu;
// Emphase markdown : * _ ~ `
const EMPHASIS_RE = /[*_~`]/g;
const ALNUM_RE = /[\p{L}\p{N}]/gu;

/** Retire caractères invisibles, emphase markdown et espaces (y compris insécables). */
export function stripNoise(text) {
    return String(text ?? '')
        .replace(INVISIBLE_RE, '')
        .replace(EMPHASIS_RE, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Nombre de lettres/chiffres (unicode) dans le texte. */
export function countAlnum(text) {
    const m = String(text ?? '').match(ALNUM_RE);
    return m ? m.length : 0;
}

/**
 * Compile une liste de regex (une par ligne). Formats acceptés : `/motif/flags` ou motif simple (insensible à la casse).
 * Les lignes invalides sont ignorées.
 */
export function parseCustomRegexes(text) {
    const out = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        try {
            const m = line.match(/^\/([\s\S]+)\/([a-z]*)$/);
            out.push(m ? new RegExp(m[1], m[2]) : new RegExp(line, 'i'));
        } catch { /* regex invalide : ignorée */ }
    }
    return out;
}

/**
 * Le message est-il « vide » ?
 * @param {string} text Texte brut du message
 * @param {{minChars?: number, customRegex?: string}} [opts]
 * @returns {{empty: boolean, reason: string}}
 */
export function isEmptyReply(text, opts = {}) {
    const raw = typeof text === 'string' ? text : '';
    const minChars = Math.max(1, Number.isFinite(Number(opts.minChars)) ? Math.floor(Number(opts.minChars)) : 2);

    const cleaned = stripNoise(raw);
    if (!cleaned) return { empty: true, reason: 'vide' };

    const n = countAlnum(cleaned);
    if (n < minChars) return { empty: true, reason: `moins de ${minChars} caractère(s) alphanumérique(s)` };

    for (const re of parseCustomRegexes(opts.customRegex)) {
        try {
            re.lastIndex = 0;
            if (re.test(raw.trim()) || re.test(cleaned)) return { empty: true, reason: `regex ${re}` };
        } catch { /* ignorée */ }
    }
    return { empty: false, reason: '' };
}
