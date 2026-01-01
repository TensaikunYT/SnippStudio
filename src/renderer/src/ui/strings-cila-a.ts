// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words of cila A (editing in the preview: the crop mode, the safe-area
// guides, where the preview's pan went). Each key in both languages; the type
// asks for both and src/test/strings-cila-a.test.ts checks it. Spread into
// STRINGS (ui/strings.ts). A file of its own: other work was adding words to
// the other files at the same time.

/** One text of cila A: English and Turkish both. */
interface Both {
  en: string
  tr: string
}

export const STRINGS_CILA_A = {
  // ---- the preview toolbar (components/PreviewToolbar.tsx) ----------------------
  'pv.crop': { en: 'Crop', tr: 'Kırp' },
  'pv.crop.hint': {
    en: 'Crop the selected clip in the preview: drag an edge or a corner, drag inside to slide the window. Shift keeps its shape, Alt works from the middle, Esc leaves.',
    tr: 'Seçili klibi önizlemede kırp: bir kenarı ya da köşeyi sürükle, içinden sürükleyerek pencereyi kaydır. Shift biçimini korur, Alt ortadan çalışır, Esc çıkar.'
  },
  'pv.crop.none': { en: 'Crop: select a video or picture clip under the playhead first', tr: 'Kırp: önce oynatma çizgisinin altında bir video ya da görsel klibi seç' },
  'pv.safe': { en: 'Safe areas', tr: 'Güvenli alan' },
  'pv.safe.hint': {
    en: 'Two frames inside the picture, 5 % and 10 % in from its edges (titles snap to the 5 % one); preview only',
    tr: 'Görüntünün içinde iki çerçeve, kenarlardan %5 ve %10 içeride (başlıklar %5 olana yapışır); yalnız önizlemede'
  },
  // ---- the canvas (components/PreviewCanvas.tsx) --------------------------------
  'pv.canvas': {
    en: 'Preview. Drag a picture to move it; the arrow keys move the selection by 1 pixel, with Shift by 10.',
    tr: 'Önizleme. Bir görüntüyü sürükleyerek taşı; ok tuşları seçimi 1 piksel, Shift ile 10 piksel kaydırır.'
  },
  'pv.pan.moved': {
    en: 'The preview is moved with the middle mouse button or Space + drag. Alt now sizes a picture from its middle.',
    tr: 'Önizleme orta fare tuşuyla ya da Boşluk + sürükleyerek kaydırılır. Alt artık görüntüyü ortasından boyutlandırır.'
  }
} satisfies Record<string, Both>
