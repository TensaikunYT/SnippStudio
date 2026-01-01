// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The ideas from VideoHub's review page (ONIZLEME-UYGULA-PLAN.md): the clock
// you type into, the play speed, the preview's zoom keys, going from note to
// note, the click-and-type note, the review's before / after, the draft's
// three comparisons, the narration line and the shortcut list. English and
// Turkish, the same parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_ONIZLEME = {
  // ---- the new actions (Settings → Keyboard shortcuts, the ? list)
  'keys.act.goToTime': { en: 'Go to a time or frame', tr: 'Bir zamana ya da kareye git' },
  'keys.act.slower': { en: 'Play slower', tr: 'Daha yavaş oynat' },
  'keys.act.faster': { en: 'Play faster', tr: 'Daha hızlı oynat' },
  'keys.act.previewActual': { en: 'Preview at 100 % (one pixel per pixel)', tr: 'Önizleme %100 (bir piksele bir piksel)' },
  'keys.act.previewFit': { en: 'Fit the preview', tr: 'Önizlemeyi sığdır' },
  'keys.act.prevNote': { en: 'Previous work note', tr: 'Önceki iş notu' },
  'keys.act.nextNote': { en: 'Next work note', tr: 'Sonraki iş notu' },
  'keys.act.narration': { en: 'Narration line under the preview', tr: 'Önizlemenin altında anlatım satırı' },
  'keys.act.shortcutList': { en: 'Shortcut list over the preview', tr: 'Önizlemenin üstünde kısayol listesi' },
  'keys.act.reviewBefore': { en: 'In a review: before / after', tr: 'Turda: önce / sonra' },
  'keys.act.reviewApprove': { en: 'In a review: approve', tr: 'Turda: onayla' },
  // ---- the clock you type into (G)
  'transport.time.go': { en: 'Go to a time or frame', tr: 'Bir zamana ya da kareye git' },
  'transport.time.hint': { en: 'Type 1:23.45, 83.4, k1234 (a frame), +2 or -10f; Enter goes there', tr: '1:23,45, 83,4, k1234 (kare), +2 ya da -10f yaz; Enter oraya gider' },
  'transport.time.bad': { en: 'Not a time: try 1:23.45, 83.4, k1234, +2 or -10f', tr: 'Zaman değil: 1:23,45, 83,4, k1234, +2 ya da -10f dene' },
  // ---- play speed
  'transport.rate': { en: 'Play speed', tr: 'Oynatma hızı' },
  'transport.rate.hint': { en: 'How fast the preview plays ([ slower, ] faster). The export is not changed.', tr: 'Önizlemenin oynama hızı ([ yavaş, ] hızlı). Dışa aktarma değişmez.' },
  'transport.rate.now': { en: 'Play speed {rate}', tr: 'Oynatma hızı {rate}' },
  // ---- the preview's zoom
  // (22 November: "1:1", not a second "100 %" beside the zoom's own number.)
  'preview.actual': { en: '1:1', tr: '1:1' },
  'preview.actual.hint': { en: 'Real size (100 %): one pixel of the project on one pixel of the screen', tr: 'Gerçek boy (%100): projenin bir pikseli ekranın bir pikselinde' },
  // ---- going from note to note
  'notes.lane.group': { en: '{n} notes here: {nums}. Click: the next one', tr: 'Burada {n} not: {nums}. Tıkla: sıradaki' },
  // ---- the click-and-type note
  'notes.quick.label': { en: 'Note at this point', tr: 'Bu noktaya not' },
  'notes.quick.placeholder': { en: 'What is wrong here? Enter saves', tr: 'Burada ne yanlış? Enter kaydeder' },
  'notes.quick.hint': { en: 'Enter: save and play on · Shift+Enter: new line · Esc: close · Space (empty): carry on', tr: 'Enter: kaydet ve sürdür · Shift+Enter: yeni satır · Esc: kapat · Boşluk (boşken): devam et' },
  'notes.quick.empty': { en: 'Say what is wrong first (or press Esc)', tr: 'Önce neyin yanlış olduğunu yaz (ya da Esc)' },
  // ---- the review's before / after and "still there"
  'review.before': { en: 'Before / after', tr: 'Önce / sonra' },
  'review.before.hint': { en: 'The frame as it was when the note was written, or the frame now', tr: 'Not yazıldığında kare nasıldı, ya da şimdi nasıl' },
  'review.before.tag': { en: 'Before: when the note was written', tr: 'Önce: not yazıldığında' },
  'review.before.none': { en: 'This note has no saved frame (only notes with a drawing keep one)', tr: 'Bu notun saklı karesi yok (yalnız çizimli notlar karesini saklar)' },
  'review.still.why': { en: 'What is still wrong?', tr: 'Hâlâ yanlış olan ne?' },
  'review.still.placeholder': { en: 'What is still wrong? Enter sends it back', tr: 'Hâlâ yanlış olan ne? Enter geri gönderir' },
  'review.still.added': { en: '{text}\n— still there: {why}', tr: '{text}\n— hâlâ var: {why}' },
  // ---- the draft's comparisons
  'agent.draft.side': { en: 'Side by side', tr: 'Yan yana' },
  'agent.draft.wipe': { en: 'Wipe', tr: 'Perde' },
  'agent.draft.diff': { en: 'Difference', tr: 'Fark' },
  'agent.draft.compare.hint': { en: 'Before and after on the same clock: side by side, a wipe you drag, or what changed lit up', tr: 'Önce ile sonra aynı saatle: yan yana, sürüklenen perde, ya da değişen yer parlak' },
  'compare.before': { en: 'Before', tr: 'Önce' },
  'compare.after': { en: 'After', tr: 'Sonra' },
  'compare.diff': { en: 'Difference: what changed is bright', tr: 'Fark: değişen yer parlak' },
  'compare.wipe': { en: 'Drag: before on the left, after on the right', tr: 'Sürükle: solda önce, sağda sonra' },
  'compare.draft': { en: 'Draft quality while comparing', tr: 'Karşılaştırırken taslak kalite' },
  // ---- the narration line
  'narration.name': { en: 'Narration', tr: 'Anlatım' },
  'narration.none': { en: 'No narration at this moment', tr: 'Bu anda anlatım yok' },
  'narration.empty': { en: 'This project has no subtitles to read from', tr: 'Bu projede okunacak altyazı yok' },
  // ---- the shortcut list
  'keys.list.title': { en: 'Shortcuts', tr: 'Kısayollar' },
  'keys.list.all': { en: 'All shortcuts', tr: 'Bütün kısayollar' },
  'keys.list.close': { en: 'Close the list', tr: 'Listeyi kapat' },
  'keys.list.hold': { en: '{what} (hold: repeats)', tr: '{what} (basılı tut: tekrarlar)' },
  'keys.list.spaceDrag': { en: 'Space + drag', tr: 'Boşluk + sürükle' },
  'keys.list.spaceDrag.what': { en: 'Move the zoomed preview (a short press plays)', tr: 'Yakınlaştırılmış önizlemeyi kaydır (kısa basış oynatır)' },
  'keys.list.wheel': { en: 'Ctrl + wheel', tr: 'Ctrl + tekerlek' },
  'keys.list.wheel.what': { en: 'Zoom the preview under the pointer', tr: 'Önizlemeyi imlecin altında büyüt' },
  'keys.list.click': { en: 'Point tool + click', tr: 'İşaretle + tıkla' },
  'keys.list.click.what': { en: 'Stops, puts a pin there and opens a box: type, Enter', tr: 'Durdurur, oraya iğne koyar ve kutu açar: yaz, Enter' }
} as const
