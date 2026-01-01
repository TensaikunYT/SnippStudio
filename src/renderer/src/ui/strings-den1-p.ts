// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's first try, worker P (tarifler/DENEME-1.md, DENEME-1-PLAN-P.md):
// the words of the left panel's Text page and its closing, and of the green
// screen's eyedropper. English and Turkish, the same parameters. Spread into
// STRINGS by ui/strings.ts.
export const STRINGS_DEN1_P = {
  // ---- the green screen's eyedropper
  'insp.chroma.dropper': { en: 'Eyedropper', tr: 'Damlalık' },
  'insp.chroma.dropper.armed': { en: 'Click the color to key in the preview. Esc stops.', tr: 'Önizlemede silinecek renge tıkla. Esc vazgeçer.' },
  // ---- the left panel closes
  'dock.close': { en: 'Close the panel', tr: 'Paneli kapat' },
  'dock.cat.closed': { en: '{name} (the panel is closed: click to open)', tr: '{name} (panel kapalı: açmak için tıkla)' },
  // ---- Text: text and titles first, the templates a sub-page
  'dock.text.tab.text': { en: 'Text', tr: 'Yazı' },
  'dock.text.tab.templates': { en: 'Templates', tr: 'Şablonlar' },
  'dock.text.tabs': { en: 'Text or templates', tr: 'Yazı ya da şablonlar' },
  'dock.text.add': { en: 'Add text', tr: 'Yazı ekle' },
  'dock.text.add.hint': { en: 'A title at the playhead, in the middle of the picture: type at once. Or drag it onto the preview or the timeline.', tr: 'Oynatma çizgisine, resmin ortasına bir başlık: hemen yaz. Ya da önizlemeye veya çizelgeye sürükle.' },
  'dock.text.plain': { en: 'Plain', tr: 'Sade' },
} as const
