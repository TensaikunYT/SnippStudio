// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Dalga 2, S (SESSIZ-PLAN.md): where "Remove silence" cuts. Short: a choice's
// name and one line of what it does. English and Turkish, the same
// parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_SESSIZ = {
  'ss.target': { en: 'Where to cut?', tr: 'Kesim nereye uygulansın?' },
  'ss.target.picked': { en: 'Picked sound', tr: 'Seçili ses' },
  'ss.target.picked.hint': { en: 'Only the picked sound and the picture linked to it', tr: 'Yalnız seçili ses ve ona bağlı görüntü' },
  'ss.target.speech': { en: 'Speech', tr: 'Konuşma' },
  'ss.target.speech.hint': { en: 'Only the speech and the picture linked to it', tr: 'Yalnız konuşma ve ona bağlı görüntü' },
  'ss.target.all': { en: 'All tracks', tr: 'Bütün izler' },
  'ss.target.all.hint': { en: 'Every unlocked track: everything stays in step', tr: 'Kilitsiz bütün izler: eşzaman korunur' },
  'ss.target.custom': { en: 'Choose…', tr: 'Seçeceğim…' },
  'ss.target.custom.hint': { en: 'Tick the tracks to cut', tr: 'Kesilecek izleri işaretle' },
  'ss.tracks': { en: 'Tracks to cut', tr: 'Kesilecek izler' },
  'ss.linked': { en: '{name} · linked', tr: '{name} · bağlı' },
  'ss.lockedTrack': { en: '{name} · locked', tr: '{name} · kilitli' },
  'ss.and': { en: ' and ', tr: ' ve ' },
  'ss.line': { en: '{cut} will be cut · {kept} stay in place', tr: '{cut} kesilecek · {kept} yerinde kalacak' },
  'ss.line.one': { en: '{cut} will be cut · {kept} stays in place', tr: '{cut} kesilecek · {kept} yerinde kalacak' },
  'ss.line.all': { en: '{cut} will be cut', tr: '{cut} kesilecek' },
  'ss.line.none': { en: 'No track is ticked: nothing will be cut', tr: 'İşaretli iz yok: hiçbir şey kesilmeyecek' },
  'ss.locked': { en: 'Locked, stays in place: {tracks}', tr: 'Kilitli, yerinde kalır: {tracks}' },
  'ss.drift': { en: 'The tracks left uncut may fall out of step with the sound.', tr: 'Kesilmeyen izlerin sesle eşzamanı kayabilir.' }
} as const
