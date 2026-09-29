# No Empty Reply (SillyTavern)

**FR** — Extension SillyTavern qui détecte les réponses de bot vides ou quasi vides (`.`, `…`, `-`, `*`, espaces, caractères invisibles) et **régénère automatiquement** (swipe) jusqu'à N fois, puis s'arrête (avertissement `toastr`) pour éviter toute boucle. Fonctionne en chat simple et en **chat de groupe**.

**EN** — SillyTavern extension that detects empty / punctuation-only bot replies and automatically swipes up to N times, then stops. Works in solo and group chats.

> ⚠️ **Non testée dans SillyTavern** : écrite d'après le code source de la branche `release` de SillyTavern (`getContext`, `eventSource`, `swipe`, `/trigger`), mais jamais exécutée dans une vraie instance. Ouvre une issue en cas de problème. / *Untested inside SillyTavern; written against its source only.*

## Installation

SillyTavern → **Extensions** → **Install extension** → colle l'URL :

```
https://github.com/hydravnss/no-empty-reply
```

Réglages : Extensions → **No Empty Reply**.

## Fonctionnement

- Hook `MESSAGE_RECEIVED` : ne regarde que les messages de bot (jamais utilisateur ni système).
- **Détection** : on retire espaces, emphase markdown (`* _ ~ \``) et caractères invisibles ; le message est « vide » s'il ne reste rien ou moins de **N lettres/chiffres** (Unicode, `\p{L}\p{N}`, défaut 2 : « Ok » passe, « . » / « … » / « * » non). `*sourit*` est valide.
- **Régénération** : après ~300 ms, swipe droit (même mécanisme que l'auto-swipe natif). Repli : suppression du message + `/trigger` (en groupe : le même personnage).
- **Garde-fous** : compteur d'essais par index de message, remis à zéro quand une bonne réponse arrive, à l'envoi d'un message ou au changement de chat.

## Réglages

Activer, essais max (2), lettres/chiffres minimum (2), regex personnalisées « aussi vide » (une par ligne, `/motif/flags` ou motif simple), notifications on/off.

## Tests

```
node tests/detect.test.mjs
```

## Licence

MIT
