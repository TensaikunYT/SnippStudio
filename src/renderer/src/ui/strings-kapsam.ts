// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent's scope (SnippStudio KAPSAM-AJAN-PLAN.md): the range band and its
// box, a clip's "For the agent" menu, the lock against agents, and the two
// reasons an op of a draft is not applied for it. English and Turkish, the
// same parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_KAPSAM = {
  // ---- why an op was not applied (agent/drop-words.ts) ---------------------------
  'd22c.drop.scope': { en: 'Out of scope: not applied. It wrote outside the stretch (or the clips) you gave this work.', tr: 'Kapsam dışında: uygulanmadı. Bu iş için verdiğin aralığın (ya da kliplerin) dışına yazıyordu.' },
  'd22c.drop.clipLock': { en: 'You locked that clip against the agent: it stays as it is.', tr: 'O klibi ajana kilitledin: olduğu gibi kaldı.' },
  // ---- the toolbar's "Range" and the band on the timeline --------------------------
  'kapsam.tool.range': { en: 'Range', tr: 'Aralık' },
  'kapsam.tool.range.hint': { en: 'Give the agent a stretch of the timeline: drag on the ruler (Alt + drag works any time). Takes the loop, the cut marks or the selected clips when there are any.', tr: 'Ajana çizelgeden bir aralık ver: cetvelde sürükle (Alt + sürükle her zaman çalışır). Döngü, kesim işaretleri ya da seçili klipler varsa onları alır.' },
  'kapsam.band.new': { en: 'Range · {len}', tr: 'Aralık · {len}' },
  'kapsam.band.working': { en: 'Working · {len}', tr: 'Çalışılıyor · {len}' },
  'kapsam.band.draft': { en: 'Draft ready · {len}', tr: 'Taslak hazır · {len}' },
  'kapsam.band.done': { en: 'Done · {len}', tr: 'Bitti · {len}' },
  'kapsam.band.len': { en: '{s} s', tr: '{s} sn' },
  'kapsam.band.close': { en: 'Remove the range', tr: 'Aralığı kaldır' },
  // ---- the box under the band -------------------------------------------------------
  'kapsam.box': { en: 'For the agent', tr: 'Ajan için' },
  'kapsam.box.ask': { en: 'What should be done in this range?', tr: 'Bu aralıkta ne yapılsın?' },
  'kapsam.box.askClips': { en: 'What should be done with these clips?', tr: 'Bu kliplerle ne yapılsın?' },
  'kapsam.box.only': { en: 'Change only inside this range', tr: 'Yalnız bu aralıkta değiştirsin' },
  'kapsam.box.onlyClips': { en: 'Change only these clips', tr: 'Yalnız bu kliplerde değiştirsin' },
  'kapsam.box.only.hint': { en: 'The program keeps the limit: what the agent writes outside it is not applied.', tr: 'Sınırı program uygular: ajanın dışarıya yazdığı uygulanmaz.' },
  'kapsam.box.send': { en: 'Send', tr: 'Gönder' },
  'kapsam.box.keep': { en: 'Keep the words as a chip', tr: 'Yazdığını çip olarak sakla' },
  'kapsam.box.keep.empty': { en: 'Type the words first, then keep them as a chip', tr: 'Önce yaz, sonra çip olarak sakla' },
  'kapsam.box.drop': { en: 'Remove the chip "{name}"', tr: '"{name}" çipini kaldır' },
  'kapsam.chip.animate': { en: 'Add an animation here', tr: 'Buraya animasyon ekle' },
  'kapsam.chip.shorten': { en: 'Shorten', tr: 'Kısalt' },
  'kapsam.chip.silences': { en: 'Clean up the silences', tr: 'Sessizlikleri temizle' },
  'kapsam.chip.captions': { en: 'Fix the subtitles', tr: 'Altyazıyı düzelt' },
  'kapsam.chip.unrelated': { en: 'This clip does not fit the sound', tr: 'Bu klip sesle alakasız' },
  'kapsam.chip.change': { en: 'Change this', tr: 'Bunu değiştir' },
  // ---- a clip's menu, and the lock -----------------------------------------------------
  'kapsam.menu.forAgent': { en: 'For the agent', tr: 'Ajan için' },
  'kapsam.menu.note': { en: 'Leave a note…', tr: 'Not bırak…' },
  'kapsam.menu.only': { en: 'Work only on the selected clips…', tr: 'Yalnız seçili kliplerde çalış…' },
  'kapsam.menu.lock': { en: 'Don’t let the agent touch this clip', tr: 'Ajan bu klibe dokunmasın' },
  'kapsam.menu.unlock': { en: 'Let the agent touch it again', tr: 'Ajan yine dokunabilsin' },
  'kapsam.lock.hint': { en: 'Locked against the agent: what it writes to this clip is not applied. Your own edits work as always.', tr: 'Ajana kilitli: ajanın bu klibe yazdığı uygulanmaz. Senin düzenlemelerin her zamanki gibi.' }
} as const
