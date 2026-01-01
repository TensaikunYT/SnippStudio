// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// REF-AB, worker I (REF-AB-PLAN-I.md): the Inspector's card reset, the key
// arrows, the scale lock mark, the ready speed curves and the length, the
// clip animations' grid. English and Turkish, the same parameters
// (src/test/ref-i.test.ts). Spread into STRINGS by ui/strings.ts.
export const STRINGS_REF_I = {
  // ---- item 2: a card's reset, a value's key arrows
  'refi.reset': { en: 'Reset {card}', tr: '{card} sıfırla' },
  'refi.reset.clean': { en: '{card}: nothing to reset', tr: '{card}: sıfırlanacak bir şey yok' },
  'refi.key.prev': { en: 'Previous key of this value', tr: 'Bu değerin önceki anahtar karesi' },
  'refi.key.next': { en: 'Next key of this value', tr: 'Bu değerin sonraki anahtar karesi' },
  'refi.key.volume': { en: 'Volume key at the playhead (on a key: remove it)', tr: 'Oynatma çizgisinde ses anahtar karesi (bir karedeyse: kaldır)' },

  // ---- item 3: the scale's lock mark

  // ---- item 4: the ready speed curves and the length
  'refi.shape.none': { en: 'No curve', tr: 'Eğri yok' },
  'refi.shape.none.hint': { en: 'Back to one speed (the clip keeps its length)', tr: 'Tek hıza dön (klip uzunluğunu korur)' },
  'refi.shape.custom': { en: 'Your own', tr: 'Kendi eğrin' },
  'refi.shape.custom.hint': { en: 'Draw your own curve on the graph below', tr: 'Aşağıdaki çizimde kendi eğrini çiz' },
  'refi.shape.rhythm': { en: 'Rhythm', tr: 'Ritim' },
  'refi.shape.moment': { en: 'Big moment', tr: 'Büyük an' },
  'refi.shape.timestop': { en: 'Time stop', tr: 'Zaman durur' },
  'refi.shape.skip': { en: 'Skip ahead', tr: 'İleri sıçra' },
  'refi.shape.rushIn': { en: 'Rush in', tr: 'Hızlı açılış' },
  'refi.shape.rushOut': { en: 'Rush out', tr: 'Hızlı kapanış' },
  'refi.speed.length': { en: 'Length', tr: 'Süre' },
  'refi.speed.lengthFrom': { en: '{s} s →', tr: '{s} sn →' },
  'refi.speed.length.hint': { en: 'The footage lasts this long at 1×; type a length and the speed is set to fit it.', tr: 'Görüntü 1× hızda bu kadar sürer; bir süre yazınca hız ona göre ayarlanır.' },

  // ---- item 9: the clip animations' grid
  'refi.anim.part.idle': { en: 'Throughout', tr: 'Süreğen' },
  'refi.anim.grid': { en: 'Animations', tr: 'Animasyonlar' },
  'refi.anim.search': { en: 'Search animations', tr: 'Animasyon ara' },
  'refi.anim.kinds': { en: 'Kinds of animation', tr: 'Animasyon türleri' },
  'refi.anim.noneFound': { en: 'No animation matches.', tr: 'Eşleşen animasyon yok.' },
  'refi.anim.kind.all': { en: 'All', tr: 'Hepsi' },
  'refi.anim.kind.basic': { en: 'Basic', tr: 'Temel' },
  'refi.anim.kind.slide': { en: 'Slide', tr: 'Kayma' },
  'refi.anim.kind.lively': { en: 'Lively', tr: 'Canlı' },
  'refi.anim.kind.ramp': { en: 'Speed ramp', tr: 'Hız rampası' }
} as const satisfies Record<string, { en: string; tr: string }>
