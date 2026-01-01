// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The team mode (EKIP-PLAN.md): an agent's subagents shown one by one — the
// bar's workers, their flags on the ruler, the steps by worker, the tokens
// by worker, the draft's groups and which worker's change an op dropped
// after. English and Turkish, the same parameters; a text that depends on a
// count has ".one" and ".other" (agent/count.ts). Spread into STRINGS by
// ui/strings.ts.
export const STRINGS_EKIP = {
  // ---- the agent bar -------------------------------------------------------------
  'ekip.bar.team.one': { en: '{name} · {n} worker', tr: '{name} · {n} işçi' },
  'ekip.bar.team.other': { en: '{name} · {n} workers', tr: '{name} · {n} işçi' },
  'ekip.bar.workers': { en: 'Workers', tr: 'İşçiler' },
  'ekip.bar.worker.hint': { en: '{name}: {what}', tr: '{name}: {what}' },
  'ekip.bar.worker.idle': { en: 'no call yet', tr: 'henüz çağrı yok' },
  // ---- the flags on the ruler ---------------------------------------------------------
  'ekip.flag.label': { en: '{name}, a worker of {program}', tr: '{name}, {program} işçisi' },
  'ekip.flag.more': { en: '+{n}', tr: '+{n}' },
  'ekip.flag.more.hint': { en: 'Also here: {names}', tr: 'Burada ayrıca: {names}' },
  // ---- the Agent tab's steps --------------------------------------------------------
  'ekip.steps.filter': { en: 'Steps of', tr: 'Kimin adımları' },
  'ekip.steps.all': { en: 'All', tr: 'Hepsi' },
  // ---- the token card -------------------------------------------------------------
  'ekip.tokens.byWorker': { en: 'Answers, by worker', tr: 'Cevaplar, işçiye göre' },
  // ---- the draft's groups ---------------------------------------------------------------
  'ekip.group.menu': { en: 'Changes by worker', tr: 'İşçiye göre değişiklikler' },
  'ekip.group.all': { en: 'All · {n}', tr: 'Hepsi · {n}' },
  'ekip.group.one': { en: '{name} · {n}', tr: '{name} · {n}' },
  'ekip.group.hint': { en: 'Go through one worker’s changes, and accept or reject them together', tr: 'Bir işçinin değişikliklerini gez, birlikte kabul ya da reddet' },
  'ekip.group.accept': { en: 'Accept group', tr: 'Grubu kabul et' },
  'ekip.group.reject': { en: 'Reject group', tr: 'Grubu reddet' },
  'ekip.group.accepted': { en: '{name}’s changes accepted (one undo step).', tr: '{name} işçisinin değişiklikleri kabul edildi (tek geri alma adımı).' },
  'ekip.group.rejected': { en: '{name}’s changes are out of the draft.', tr: '{name} işçisinin değişiklikleri taslaktan çıkarıldı.' },
  'ekip.group.wouldDrop': { en: 'Accepting {name}’s changes now would drop another worker’s change ({what}): decide that one first.', tr: '{name} işçisinin değişiklikleri şimdi kabul edilirse başka bir işçinin değişikliği düşer ({what}): önce ona karar ver.' },
  'ekip.group.leans': { en: 'Some of {name}’s changes rest on another worker’s: decide those first.', tr: '{name} işçisinin bazı değişiklikleri başka bir işçininkine dayanıyor: önce onlara karar ver.' },
  // ---- a collision, said to the user --------------------------------------------------------
  'ekip.drop.after': { en: 'Dropped after {name}’s change.', tr: '{name} işçisinin değişikliğinden sonra düştü.' }
} as const
