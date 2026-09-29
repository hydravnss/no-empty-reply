/**
 * No Empty Reply - extension SillyTavern
 * Détecte les réponses de bot vides ou quasi vides (".", "…", "*", "-", espaces…)
 * et régénère automatiquement (swipe) jusqu'à N fois, puis s'arrête pour éviter les boucles.
 * Fonctionne en chat simple et en groupe.
 *
 * Vanilla ES module, aucune étape de build.
 * Chemin attendu : /scripts/extensions/third-party/no-empty-reply/index.js
 */

// Import en namespace : si un export manque dans une version de ST, l'extension ne plante pas au chargement.
import * as stScript from '../../../../script.js';
import * as stExtensions from '../../../extensions.js';
import { isEmptyReply } from './detect.js';

const MODULE_NAME = 'no-empty-reply';
const LOG = '[No Empty Reply]';
const TITLE = 'No Empty Reply';
const SWIPE_DELAY_MS = 300; // laisse le rendu du message se terminer avant de swiper
const MAX_RETRIES_LIMIT = 10;

const defaultSettings = Object.freeze({
    enabled: true,
    maxRetries: 2,
    minChars: 2,
    customRegex: '',
    showToasts: true,
});

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function getSettings() {
    const store = stExtensions.extension_settings;
    if (!store[MODULE_NAME] || typeof store[MODULE_NAME] !== 'object') {
        store[MODULE_NAME] = {};
    }
    const s = store[MODULE_NAME];
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (s[key] === undefined) s[key] = value;
    }
    return s;
}

function saveSettings() {
    try {
        stScript.saveSettingsDebounced();
    } catch (e) {
        console.warn(LOG, 'saveSettingsDebounced a échoué', e);
    }
}

function ctx() {
    return stExtensions.getContext();
}

function notify(type, message, title = TITLE, force = false) {
    try {
        if (!force && !getSettings().showToasts) return;
        const t = globalThis.toastr;
        if (t && typeof t[type] === 'function') t[type](message, title);
    } catch { /* ne jamais casser le chat */ }
}

function detectOptions() {
    const s = getSettings();
    return { minChars: s.minChars, customRegex: s.customRegex };
}

function safeHandler(name, fn) {
    return async (...args) => {
        try {
            await fn(...args);
        } catch (e) {
            console.error(LOG, `Erreur dans ${name} (ignorée)`, e);
        }
    };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// État des tentatives (compteur par index de message)
// ---------------------------------------------------------------------------

/** index du message -> nombre de régénérations déjà lancées */
const retryCounts = new Map();
let pending = false; // une régénération est déjà planifiée / en cours

function currentChatKey() {
    try {
        const c = ctx();
        return String(c.getCurrentChatId?.() ?? c.chatId ?? '');
    } catch { return ''; }
}
let chatKey = null;

function resetAll() {
    retryCounts.clear();
    pending = false;
    chatKey = currentChatKey();
}

function isBusy() {
    try {
        if (typeof stScript.isGenerating === 'function' && stScript.isGenerating()) return true;
        if (stScript.is_send_press) return true;
        const st = ctx().swipe?.state?.();
        if (st && st !== 'none') return true;
        return false;
    } catch { return false; }
}

async function waitUntilIdle(timeoutMs = 30000) {
    const start = Date.now();
    let stable = 0;
    while (Date.now() - start < timeoutMs) {
        if (!isBusy()) {
            stable++;
            if (stable >= 3) return true;
        } else {
            stable = 0;
        }
        await sleep(200);
    }
    return false;
}

// ---------------------------------------------------------------------------
// Régénération
// ---------------------------------------------------------------------------

/** Argument de /trigger pour relancer le même personnage dans un groupe (index du membre, sinon nom). */
function groupTriggerArg(c, message) {
    try {
        const group = c.groups?.find(g => String(g.id) === String(c.groupId));
        const avatar = message.original_avatar;
        if (group && Array.isArray(group.members) && avatar) {
            const idx = group.members.indexOf(avatar);
            if (idx >= 0) return String(idx);
        }
    } catch { /* repli sur le nom */ }
    return message.name ? String(message.name) : '';
}

async function runTrigger(c, arg) {
    const cmd = arg ? `/trigger ${arg}` : '/trigger';
    if (typeof c.executeSlashCommandsWithOptions === 'function') {
        await c.executeSlashCommandsWithOptions(cmd);
    } else if (typeof c.executeSlashCommands === 'function') {
        await c.executeSlashCommands(cmd);
    } else {
        throw new Error('API de commandes slash indisponible');
    }
}

/**
 * Supprime le message vide puis relance la génération du même personnage.
 * Repli utilisé si le swipe n'est pas possible (ou en groupe si le message n'est plus le dernier).
 */
async function deleteAndTrigger(id, message, count) {
    const c = ctx();
    // Dernière vérification : ne jamais supprimer un message devenu valide (édité) ou d'utilisateur.
    if (c.chat[id] !== message || message.is_user || message.is_system) return;
    if (!isEmptyReply(message.mes, detectOptions()).empty) return;

    const arg = c.groupId ? groupTriggerArg(c, message) : '';
    await c.deleteMessage(id);
    // Le nouveau message prendra l'index chat.length : on y reporte le compteur.
    retryCounts.set(c.chat.length, count);
    await runTrigger(c, arg);
}

async function regenerate(id, message, count) {
    pending = true;
    try {
        await sleep(SWIPE_DELAY_MS);
        const idle = await waitUntilIdle();
        const c = ctx();
        if (!idle || c.chat[id] !== message) {
            console.warn(LOG, 'Régénération annulée (occupé ou message modifié).');
            return;
        }
        // Le message a pu être corrigé à la main entre-temps.
        if (!isEmptyReply(message.mes, detectOptions()).empty) return;

        // Le verrou ne couvre que l'attente : le swipe attend la fin de la génération, et le
        // MESSAGE_RECEIVED de la nouvelle réponse doit pouvoir déclencher l'essai suivant.
        pending = false;

        const isLast = id === c.chat.length - 1;

        if (isLast) {
            try {
                if (c.swipe && typeof c.swipe.to === 'function') {
                    // Même mécanisme que l'auto-swipe natif de ST (fonctionne aussi en groupe :
                    // Generate('swipe') réactive le personnage d'origine via original_avatar).
                    await c.swipe.to(null, 'right', { source: 'auto_swipe', repeated: true, forceMesId: id });
                    return;
                }
                throw new Error('swipe API indisponible');
            } catch (e) {
                console.warn(LOG, 'Swipe impossible, repli suppression + /trigger', e);
            }
        } else if (!c.groupId) {
            console.warn(LOG, 'Le message vide n\'est plus le dernier du chat : rien n\'est modifié.');
            return;
        }

        await deleteAndTrigger(id, message, count);
    } catch (e) {
        console.error(LOG, 'Régénération en erreur', e);
    } finally {
        pending = false;
    }
}

async function processMessage(id, eventType) {
    const settings = getSettings();
    if (!settings.enabled) return;
    if (eventType === 'impersonate' || eventType === 'first_message') return;

    const c = ctx();
    const chat = c?.chat;
    if (!Array.isArray(chat) || !chat.length) return;

    const key = currentChatKey();
    if (chatKey !== key) resetAll();

    let index = Number(id);
    if (!Number.isInteger(index) || index < 0 || index >= chat.length) index = chat.length - 1;
    const message = chat[index];
    // Jamais les messages utilisateur / système.
    if (!message || message.is_user || message.is_system) return;
    if (message.extra?.type === 'narrator') return;

    const verdict = isEmptyReply(message.mes, detectOptions());
    if (!verdict.empty) {
        retryCounts.delete(index); // bonne réponse : on repart de zéro
        return;
    }

    const count = retryCounts.get(index) ?? 0;
    const max = Math.max(0, Math.min(MAX_RETRIES_LIMIT, Number(settings.maxRetries) || 0));
    if (count >= max) {
        retryCounts.delete(index);
        console.warn(LOG, `Réponse vide (${verdict.reason}) : nombre max de régénérations atteint (${max}).`);
        notify('warning', `Réponse vide (${message.name || 'bot'}) : ${max} régénération(s) sans succès, arrêt.`);
        return;
    }
    if (pending) return;

    retryCounts.set(index, count + 1);
    notify('info', `Réponse vide détectée (${message.name || 'bot'}). Régénération ${count + 1}/${max}…`);
    // Asynchrone volontaire : on ne bloque pas le flux de génération de ST.
    setTimeout(() => { regenerate(index, message, count + 1).catch(e => console.error(LOG, e)); }, 0);
}

// ---------------------------------------------------------------------------
// Panneau de réglages
// ---------------------------------------------------------------------------

function buildSettingsHtml() {
    return `
<div id="no_empty_reply_settings" class="extension_container">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>No Empty Reply</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="ner-block">
        <label class="checkbox_label"><input type="checkbox" id="ner_enabled"><span>Activer No Empty Reply</span></label>
        <div class="ner-hint">Régénère automatiquement (swipe) une réponse de bot vide ou réduite à de la ponctuation (« . », « … », « * »…).</div>
      </div>
      <hr>
      <div class="ner-block">
        <div class="ner-row">
          <label for="ner_maxRetries">Essais max de régénération</label>
          <input type="number" id="ner_maxRetries" class="text_pole widthNatural" min="0" max="${MAX_RETRIES_LIMIT}" step="1">
        </div>
        <div class="ner-row">
          <label for="ner_minChars">Lettres/chiffres minimum</label>
          <input type="number" id="ner_minChars" class="text_pole widthNatural" min="1" max="20" step="1">
        </div>
        <div class="ner-hint">Une réponse avec moins de lettres/chiffres (après retrait des espaces, de l'emphase markdown et des caractères invisibles) est considérée comme vide.</div>
      </div>
      <hr>
      <div class="ner-block">
        <label for="ner_customRegex">Considérer aussi comme vide (regex, une par ligne, <code>/motif/flags</code> ou motif simple)</label>
        <textarea id="ner_customRegex" class="text_pole" rows="3" placeholder="/^(n\\/a|\\[vide\\])$/i"></textarea>
      </div>
      <hr>
      <div class="ner-block">
        <label class="checkbox_label"><input type="checkbox" id="ner_showToasts"><span>Afficher les notifications (toastr)</span></label>
      </div>
      <hr>
      <div class="ner-row">
        <input type="button" id="ner_test" class="menu_button" value="Tester le dernier message">
        <input type="button" id="ner_reset" class="menu_button" value="Réinitialiser les réglages">
      </div>
    </div>
  </div>
</div>`;
}

function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function syncUi() {
    const s = getSettings();
    const $ = globalThis.jQuery;
    $('#ner_enabled').prop('checked', s.enabled);
    $('#ner_maxRetries').val(s.maxRetries);
    $('#ner_minChars').val(s.minChars);
    $('#ner_customRegex').val(s.customRegex);
    $('#ner_showToasts').prop('checked', s.showToasts);
}

function bindUi() {
    const $ = globalThis.jQuery;
    const s = getSettings();

    $('#ner_enabled').on('change', function () {
        s.enabled = !!$(this).prop('checked');
        if (!s.enabled) resetAll();
        saveSettings();
    });
    $('#ner_showToasts').on('change', function () {
        s.showToasts = !!$(this).prop('checked');
        saveSettings();
    });
    $('#ner_maxRetries').on('input change', function () {
        s.maxRetries = clampInt($(this).val(), 0, MAX_RETRIES_LIMIT, defaultSettings.maxRetries);
        saveSettings();
    });
    $('#ner_minChars').on('input change', function () {
        s.minChars = clampInt($(this).val(), 1, 20, defaultSettings.minChars);
        saveSettings();
    });
    $('#ner_customRegex').on('input', function () {
        s.customRegex = String($(this).val());
        saveSettings();
    });

    $('#ner_test').on('click', () => {
        try {
            const c = ctx();
            const message = c.chat?.[c.chat.length - 1];
            if (!message || message.is_user || message.is_system) {
                notify('info', 'Le dernier message n\'est pas une réponse de bot.', 'No Empty Reply (test)', true);
                return;
            }
            const r = isEmptyReply(message.mes, detectOptions());
            if (r.empty) notify('warning', `Réponse considérée comme vide : ${r.reason}.`, 'No Empty Reply (test)', true);
            else notify('success', 'La réponse est correcte (non vide).', 'No Empty Reply (test)', true);
        } catch (e) {
            console.error(LOG, e);
        }
    });

    $('#ner_reset').on('click', () => {
        Object.assign(s, structuredClone(defaultSettings));
        saveSettings();
        syncUi();
        notify('info', 'Réglages réinitialisés.', TITLE, true);
    });
}

function mountSettings() {
    const $ = globalThis.jQuery;
    if (!$ || $('#no_empty_reply_settings').length) return;
    const host = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    if (!host.length) {
        console.warn(LOG, 'Conteneur des réglages introuvable.');
        return;
    }
    host.append(buildSettingsHtml());
    syncUi();
    bindUi();
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

function init() {
    try {
        getSettings(); // fusionne les valeurs par défaut
        resetAll();
        mountSettings();

        const { eventSource, event_types } = stScript;
        if (!eventSource || !event_types) {
            console.error(LOG, 'eventSource / event_types introuvables : extension inactive.');
            return;
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, safeHandler('MESSAGE_RECEIVED', (id, type) => processMessage(id, type)));
        // Message de l'utilisateur : on repart de zéro.
        eventSource.on(event_types.MESSAGE_SENT, safeHandler('MESSAGE_SENT', () => resetAll()));
        eventSource.on(event_types.CHAT_CHANGED, safeHandler('CHAT_CHANGED', () => resetAll()));
        console.log(LOG, 'chargé');
    } catch (e) {
        console.error(LOG, 'Initialisation échouée (chat non affecté)', e);
    }
}

if (globalThis.jQuery) {
    globalThis.jQuery(() => init());
} else {
    init();
}
