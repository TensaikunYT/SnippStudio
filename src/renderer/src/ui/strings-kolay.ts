// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Worker "kolay" (SnippStudio KOLAY-PLAN.md): the GIF output, the timeline
// search, the clips' coloured labels and the agent job's summary. English and
// Turkish, the same parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_KOLAY = {
  // ---- 1. the GIF output --------------------------------------------------------
  'kolay.gif.out': { en: 'GIF', tr: 'GIF' },
  'kolay.gif.width': { en: 'Width', tr: 'Genişlik' },
  'kolay.gif.width.option': { en: '{w} × {h} px', tr: '{w} × {h} px' },
  'kolay.gif.fps': { en: 'Frame rate', tr: 'Kare hızı' },
  'kolay.gif.fps.option': { en: '{fps} fps', tr: '{fps} fps' },
  'kolay.gif.line': { en: 'GIF · {w} × {h} · {fps} fps · no sound', tr: 'GIF · {w} × {h} · {fps} fps · sessiz' },
  'kolay.gif.long': { en: 'A GIF this long is large (about {size}): choose a shorter range or a smaller width.', tr: 'Bu uzunlukta bir GIF büyük olur (yaklaşık {size}): daha kısa bir aralık ya da daha küçük bir genişlik seçin.' },
  'kolay.gif.start': { en: 'Export GIF', tr: 'GIF dışa aktar' },
  // ---- 2. the timeline search ----------------------------------------------------
  'kolay.search': { en: 'Search the timeline', tr: 'Çizelgede ara' },
  'kolay.search.hint': { en: 'Clips, subtitles, texts, markers and notes (Ctrl+F)', tr: 'Klipler, altyazılar, yazılar, işaretçiler ve notlar (Ctrl+F)' },
  'kolay.search.placeholder': { en: 'Name, words, marker, note…', tr: 'Ad, söz, işaretçi, not…' },
  'kolay.search.results': { en: 'Found', tr: 'Bulunanlar' },
  'kolay.search.none': { en: 'Nothing found', tr: 'Bulunamadı' },
  // ---- 3. the clips' coloured labels ---------------------------------------------
  'kolay.label': { en: 'Label', tr: 'Etiket' },
  'kolay.label.red': { en: 'Red', tr: 'Kırmızı' },
  'kolay.label.orange': { en: 'Orange', tr: 'Turuncu' },
  'kolay.label.yellow': { en: 'Yellow', tr: 'Sarı' },
  'kolay.label.green': { en: 'Green', tr: 'Yeşil' },
  'kolay.label.blue': { en: 'Blue', tr: 'Mavi' },
  'kolay.label.purple': { en: 'Purple', tr: 'Mor' },
  'kolay.label.none': { en: 'No label', tr: 'Etiket yok' },
  'kolay.search.label': { en: 'Only clips labelled {name}', tr: 'Yalnız {name} etiketli klipler' },
  // ---- 4. the agent job's summary (the bar's "Done") ------------------------------
  'kolay.sum.open': { en: 'What changed', tr: 'Ne değişti' },
  'kolay.sum.title': { en: 'What this job changed', tr: 'Bu işin değiştirdikleri' },
  'kolay.sum.length': { en: 'Length', tr: 'Süre' },
  'kolay.sum.fromTo': { en: '{from} → {to}', tr: '{from} → {to}' },
  'kolay.sum.changes': { en: 'Changes', tr: 'Değişiklikler' },
  'kolay.sum.none': { en: 'none to the film', tr: 'filmde değişiklik yok' },
  'kolay.sum.unknown': { en: 'not known (the job began before this window)', tr: 'bilinmiyor (iş bu pencereden önce başladı)' },
  'kolay.sum.tokens': { en: 'Sent to the agent', tr: 'Ajana gönderilen' },
  'kolay.sum.restore': { en: 'Back to before the agent', tr: 'Ajandan önceki haline dön' },
  'kolay.sum.restored': { en: 'The project is back to before the agent (one undo step).', tr: 'Proje ajandan önceki haline döndü (tek geri alma adımı).' },
  'kolay.sum.restoreFailed': { en: 'Could not go back: {why}', tr: 'Geri dönülemedi: {why}' },
  'kolay.sum.cut.one': { en: '{n} cut', tr: '{n} kesim' },
  'kolay.sum.cut.other': { en: '{n} cuts', tr: '{n} kesim' },
  'kolay.sum.move.one': { en: '{n} move', tr: '{n} taşıma' },
  'kolay.sum.move.other': { en: '{n} moves', tr: '{n} taşıma' },
  'kolay.sum.add.one': { en: '{n} added', tr: '{n} ekleme' },
  'kolay.sum.add.other': { en: '{n} added', tr: '{n} ekleme' },
  'kolay.sum.remove.one': { en: '{n} removed', tr: '{n} silme' },
  'kolay.sum.remove.other': { en: '{n} removed', tr: '{n} silme' },
  'kolay.sum.set.one': { en: '{n} setting', tr: '{n} ayar' },
  'kolay.sum.set.other': { en: '{n} settings', tr: '{n} ayar' }
}
