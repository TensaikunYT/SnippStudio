// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words of core polish, part C (tarifler\CILA.md "C": a speed that
// changes along a clip). Each key in both languages (English is the default,
// Turkish is chosen in the settings); src/test/strings-cila-c.test.ts checks
// it. Spread into STRINGS (ui/strings.ts). A file of its own, because other
// parts of the polish add their words at the same time.

/** One text: English and Turkish both. */
interface Both {
  en: string
  tr: string
}

export const STRINGS_CILA_C = {
  // ---- one speed or a curve (components/inspector/clip-speed.tsx) -----------------
  'insp.curve.mode': { en: 'Speed', tr: 'Hız' },
  'insp.curve.mode.one': { en: 'One speed', tr: 'Tek hız' },
  'insp.curve.mode.one.hint': { en: 'The whole clip at one speed (a curve goes: the clip keeps its length, at the curve\'s average)', tr: 'Bütün klip tek hızda (eğri kalkar: klip uzunluğunu korur, eğrinin ortalamasında akar)' },
  'insp.curve.mode.curve': { en: 'Curve', tr: 'Eğri' },
  'insp.curve.mode.curve.hint': { en: 'A speed that changes along the clip', tr: 'Klip boyunca değişen hız' },
  // ---- the curve editor (components/inspector/speed-curve-editor.tsx) ---------------
  'insp.curve.editor': { en: 'Speed curve: across, the clip\'s footage from its first frame to its last; up, the speed', tr: 'Hız eğrisi: yatayda klibin görüntüsü ilk karesinden son karesine; dikeyde hız' },
  'insp.curve.howto': {
    en: 'Click to add a point, drag to move it (or use the arrow keys), double-click (or Delete) to remove it.',
    tr: 'Nokta eklemek için tıkla, taşımak için sürükle (ya da ok tuşlarını kullan), silmek için çift tıkla (ya da Delete).'
  },
  'insp.curve.point': { en: 'Point {n}: {v}×', tr: 'Nokta {n}: {v}×' },
  'insp.curve.length': { en: 'Length {now} s for {media} s of footage · average {avg}×', tr: '{media} sn görüntü için uzunluk {now} sn · ortalama {avg}×' },
  'insp.curve.range': { en: 'From {lo}× to {hi}×', tr: '{lo}× ile {hi}× arası' },
  'insp.curve.linear': { en: 'Straight between points', tr: 'Noktalar arası düz' },
  'insp.curve.linear.hint': { en: 'Off: the speed eases from one point to the next. On: it changes at an even rate.', tr: 'Kapalı: hız bir noktadan ötekine yumuşakça geçer. Açık: eşit hızla değişir.' },
  'insp.curve.reset': { en: 'Flat', tr: 'Düzle' },
  'insp.curve.reset.hint': { en: 'Two points at the clip\'s average speed', tr: 'Klibin ortalama hızında iki nokta' },
  'insp.curve.presets': { en: 'Curve shapes', tr: 'Eğri biçimleri' },
  'insp.curve.preset.easeIn': { en: 'Slow start', tr: 'Yavaş başla' },
  'insp.curve.preset.easeOut': { en: 'Slow end', tr: 'Yavaş bitir' },
  'insp.curve.preset.slowMiddle': { en: 'Slow middle', tr: 'Ortada yavaşla' },
  'insp.curve.preset.fastMiddle': { en: 'Fast middle', tr: 'Ortada hızlan' },
  'insp.curve.preset.pulse': { en: 'Pulse', tr: 'Darbe' },
  'insp.curve.preset.hint': { en: 'This shape around the clip\'s speed now ({v}×)', tr: 'Bu biçim, klibin şimdiki hızı ({v}×) çevresinde' },
  'insp.curve.silent': {
    en: 'Where the curve is slower than 0.25× or faster than 8× the clip is silent (the shaded bands), in the preview and in the export.',
    tr: 'Eğrinin 0,25×’ten yavaş ya da 8×’ten hızlı olduğu yerlerde klip sessizdir (gölgeli şeritler); önizlemede de dışa aktarmada da.'
  },
  'insp.curve.stepped': {
    en: 'Where the curve is above 16× the preview skips frames while it plays; the export has every one.',
    tr: 'Eğrinin 16×’in üstündeki yerlerinde önizleme oynarken kare atlar; dışa aktarmada her kare vardır.'
  },
  'insp.curve.ramp': {
    en: 'The speed ramp at this clip\'s cut does not bend its curve: the curve plays as drawn, the clip on the other side still ramps.',
    tr: 'Bu klibin kesimindeki hız rampası eğriyi bükmez: eğri çizildiği gibi oynar, kesimin öbür yanındaki klip yine rampa yapar.'
  }
} satisfies Record<string, Both>
