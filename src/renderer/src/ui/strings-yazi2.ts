// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A title in the preview (SnippStudio YAZI2-PLAN.md): the quick bar over a
// selected title, the field a title is typed in, a style card being dragged
// onto the preview or the timeline. English and Turkish, the same
// parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_YAZI2 = {
  // ---- the quick bar ------------------------------------------------------------------
  'yz.bar': { en: 'Text quick settings', tr: 'Yazının hızlı ayarları' },
  'yz.bar.font': { en: 'Font', tr: 'Yazı tipi' },
  'yz.bar.size': { en: 'Size', tr: 'Boy' },
  'yz.bar.colour': { en: 'Text color', tr: 'Yazı rengi' },
  'yz.bar.align.left': { en: 'Align left', tr: 'Sola hizala' },
  'yz.bar.align.center': { en: 'Center', tr: 'Ortala' },
  'yz.bar.align.right': { en: 'Align right', tr: 'Sağa hizala' },
  'yz.bar.bold': { en: 'Bold', tr: 'Kalın' },
  'yz.bar.bold.letter': { en: 'B', tr: 'K' },
  'yz.bar.italic': { en: 'Italic', tr: 'Eğik' },
  'yz.bar.italic.letter': { en: 'I', tr: 'E' },
  'yz.bar.style': { en: 'Style', tr: 'Biçim' },
  'yz.bar.style.hint': { en: 'Give the text one of the styles', tr: 'Yazıya biçimlerden birini ver' },
  // ---- the Inspector's tab while a title is the selection (the subtitles' tab otherwise) ----
  'yz.tab.text': { en: 'Text', tr: 'Yazı' },
  // ---- typing in place ----------------------------------------------------------------
  'yz.type.field': { en: 'The text’s words', tr: 'Yazının metni' },
  // ---- a card dragged out of the Text page ----------------------------------------------
  'yz.drag.preview': { en: 'Drop to put the text here', tr: 'Yazıyı buraya koymak için bırak' },
  'yz.drag.timeline': { en: 'Drop to add the text at {time}', tr: 'Yazıyı {time} anına eklemek için bırak' },
  'yz.drag.away': { en: 'Drop on the preview or the timeline', tr: 'Önizlemeye ya da çizelgeye bırak' }
} as const
