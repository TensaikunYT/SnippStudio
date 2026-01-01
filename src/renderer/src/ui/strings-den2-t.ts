// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's second try-out, worker T (SnippStudio DENEME-2-PLAN-T.md): the
// timeline's blocks, the agent's draft on the timeline, the agent at work.
// English and Turkish, the same parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_DEN2_T = {
  // (The agent's steps: 'd22a.step.nothing', ui/strings-d22-a.ts.)
  // ---- the draft, in plain words (card, timeline, bar) ---------------------------------
  'den2t.draft.len.shorter': { en: 'the film gets {d} shorter', tr: 'film {d} kısalır' },
  'den2t.draft.len.longer': { en: 'the film gets {d} longer', tr: 'film {d} uzar' },
  'den2t.draft.len.same': { en: 'the length stays {len}', tr: 'süre {len} kalır' },
  'den2t.draft.jump': { en: 'Watch out: this makes the film {d} {way} ({from} → {to}). Is that what you asked for?', tr: 'Dikkat: bu, filmi {d} {way} ({from} → {to}). İstediğin bu mu?' },
  'den2t.draft.jump.longer': { en: 'longer', tr: 'uzatıyor' },
  'den2t.draft.jump.shorter': { en: 'shorter', tr: 'kısaltıyor' },
  'den2t.change.gap': { en: 'The empty space {from}–{to} is removed ({d}); what follows starts {d} earlier', tr: '{from}–{to} arasındaki boşluk silinir ({d}); sonrası {d} erken başlar' },
  'den2t.change.cut': { en: '{from}–{to} is cut out of {names} ({d}); what follows moves up', tr: '{names} içinden {from}–{to} kesilir ({d}); sonrası öne kayar' },
  'den2t.change.moveLater': { en: '{name} moves {d} later ({from} → {to})', tr: '{name} {d} ileri kayar ({from} → {to})' },
  'den2t.change.moveEarlier': { en: '{name} moves {d} earlier ({from} → {to})', tr: '{name} {d} geri kayar ({from} → {to})' },
  'den2t.change.withPartner': { en: ', with its sound', tr: ', sesiyle birlikte' },
  'den2t.change.toTrack': { en: '{name} moves to track {track} ({at})', tr: '{name} {track} izine geçer ({at})' },
  'den2t.change.added': { en: '{name} is added on {track} at {at} ({d})', tr: '{name}, {track} izine {at} anına eklenir ({d})' },
  'den2t.change.removed': { en: '{name} is removed ({from}–{to})', tr: '{name} silinir ({from}–{to})' },
  'den2t.change.slipped': { en: '{name} shows other footage in the same place ({d} {way} in its source)', tr: '{name} aynı yerde başka görüntü gösterir (kaynağında {d} {way})' },
  'den2t.change.slip.later': { en: 'later', tr: 'ileriden' },
  'den2t.change.slip.earlier': { en: 'earlier', tr: 'geriden' },
  'den2t.change.clipSet': { en: '{name}: its settings change', tr: '{name}: ayarları değişir' },
  'den2t.change.titleAdded': { en: 'A title "{text}" is added at {at}', tr: '{at} anına "{text}" yazısı eklenir' },
  'den2t.change.none': { en: 'The draft changes nothing you can see.', tr: 'Taslak görünür bir şey değiştirmiyor.' },
  // ---- on the timeline ----------------------------------------------------------------
  'den2t.tl.later': { en: '{d} later', tr: '{d} ileri' },
  'den2t.tl.earlier': { en: '{d} earlier', tr: '{d} geri' },
  'den2t.flash.label': { en: 'Agent: {what}', tr: 'Ajan: {what}' },
  // ---- the top bar ----------------------------------------------------------------------
  'den2t.top.working': { en: 'Agent working', tr: 'Ajan çalışıyor' },
  // ---- the inbox, in plain words (item 7) -------------------------------------------------
  'den2t.inbox.hint': { en: 'Tell {agent} once: "wait for me in {app}".', tr: '{agent} için bir kez yaz: "{app} içinde bekle".' },
  'den2t.agent.generic': { en: 'the agent', tr: 'ajan' },
  // ---- item 9: several agents, one at a time ------------------------------------------
  'den2t.agents.title': { en: 'Agents', tr: 'Ajanlar' },
  'den2t.agents.holder': { en: '{name} is working on this project', tr: '{name} bu proje üzerinde çalışıyor' },
  'den2t.agents.none': { en: 'No agent has changed this project yet', tr: 'Henüz hiçbir ajan bu projeyi değiştirmedi' },
  'den2t.agents.asked': { en: '{name} wanted to connect ({time})', tr: '{name} bağlanmak istedi ({time})' },
  'den2t.agents.switch': { en: 'Switch to {name}', tr: '{name} ajanına geç' },
  'den2t.agents.handed': { en: 'The project is handed to {name}.', tr: 'Proje {name} ajanına devredildi.' },
  'den2t.agents.draftFirst.title': { en: '{name}’s draft waits', tr: '{name} ajanının taslağı bekliyor' },
  'den2t.agents.draftFirst': { en: 'Accept or reject the draft of {name} before handing the project to {to}.', tr: 'Projeyi {to} ajanına vermeden önce {name} ajanının taslağını kabul et ya da reddet.' },
  'den2t.agents.session': { en: '{name} · connected · last call {time}', tr: '{name} · bağlı · son çağrı {time}' },
  'den2t.agents.session.working': { en: '{name} · working on this project · last call {time}', tr: '{name} · bu projede çalışıyor · son çağrı {time}' },
  // ---- item 10: Codex, even when not found -------------------------------------------------
  // ---- the code clip's badge (item 5) --------------------------------------------------------
  'den2t.live': { en: 'LIVE', tr: 'CANLI' },
  'den2t.live.hint': { en: 'A code clip: drawn live from its code (HTML), not a video file', tr: 'Kod klibi: bir video dosyası değil, kodundan (HTML) canlı çizilir' }
} as const
