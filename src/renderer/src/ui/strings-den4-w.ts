// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's fourth try, worker W (DENEME-4-PLAN-W.md): the left panel makes,
// the right sets what is selected; the export window's outputs, its check's
// summary and grouped list. English and Turkish, the same parameters. Spread
// into STRINGS by ui/strings.ts.
export const STRINGS_DEN4_W = {
  // ---- the panels' jobs --------------------------------------------------------
  'w4.shapes.where': { en: 'A selected shape’s settings are on the right, in the Clip tab.', tr: 'Seçili şeklin ayarları sağda, Klip sekmesinde.' },
  'w4.markWord.title': { en: 'Marked word', tr: 'İşaretli kelime' },
  'w4.color.browse': { en: 'Browse the looks in Filters', tr: 'Görünümlere Filtreler’de göz at' },
  'w4.subs.make': { en: 'No subtitles yet. They are made on the left: from the speech, or from an .srt file. Their style is set here.', tr: 'Henüz altyazı yok. Solda üretilir: konuşmadan ya da bir .srt dosyasından. Biçimleri burada ayarlanır.' },
  'w4.subs.make.open': { en: 'Open Captions', tr: 'Altyazı sayfasını aç' },
  'w4.captions.style': { en: 'Their style: the Subtitles tab', tr: 'Biçimleri: Altyazı sekmesi' },
  'dock.captions.none': { en: 'No subtitles yet: generate them from the speech or import an .srt.', tr: 'Henüz altyazı yok: konuşmadan üret ya da bir .srt içe aktar.' },
  'w4.canvas.backdrop': { en: 'Background…', tr: 'Arka plan…' },

  // ---- the export window ---------------------------------------------------------
  'w4.export.out.segmentsOne': { en: 'A Shorts batch is one kind at a time: video or sound.', tr: 'Shorts parçaları tek türde dışa aktarılır: video ya da ses.' },
  'w4.export.files': { en: 'Files', tr: 'Dosyalar' },
  'w4.export.files.same': { en: 'Same name and folder; you choose them once.', tr: 'Aynı ad ve klasör; bir kez seçersin.' },
  'w4.export.frameLine': { en: 'Frame: {w} × {h} · {format} · at {time} s', tr: 'Kare: {w} × {h} · {format} · {time} sn anında' },
  'w4.export.start.many': { en: 'Export {n} files', tr: '{n} dosyayı dışa aktar' },
  'w4.export.blocked.none': { en: 'Choose at least one output.', tr: 'En az bir çıktı seç.' },
  'w4.export.blocked.encoder': { en: 'This computer cannot encode the video as chosen: {why}', tr: 'Bu bilgisayar videoyu seçildiği gibi kodlayamıyor: {why}' },
  // The check before the export: one calm line, a list that opens.
  'w4.pre.summary': { en: '{n} warnings', tr: '{n} uyarı' },
  'w4.pre.summary.one': { en: '1 warning', tr: '1 uyarı' },
  'w4.pre.part': { en: '{n} {kind}', tr: '{n} {kind}' },
  'w4.pre.other': { en: '{n} other', tr: '{n} diğer' },
  'w4.pre.show': { en: 'Show the warnings', tr: 'Uyarıları göster' },
  'w4.pre.hide': { en: 'Hide the warnings', tr: 'Uyarıları gizle' },
  'w4.pre.group': { en: '{kind} × {n}', tr: '{kind} × {n}' },
  'w4.pre.kind.loud': { en: 'Sudden loud peak', tr: 'Ani ses yükselmesi' },
  'w4.pre.kind.gap': { en: 'Nothing to see', tr: 'Görünecek bir şey yok' },
  'w4.pre.kind.missing': { en: 'Missing media', tr: 'Eksik medya' },
  'w4.pre.kind.still': { en: 'Stands still', tr: 'Duruyor' },
  'w4.pre.kind.repeat': { en: 'Twice in a row', tr: 'Art arda iki kez' },
  'w4.pre.kind.loud.many': { en: 'sudden loud peaks', tr: 'ani ses yükselmesi' },
  'w4.pre.kind.gap.many': { en: 'nothing to see', tr: 'boş görüntü' },
  'w4.pre.kind.missing.many': { en: 'missing media', tr: 'eksik medya' },
  'w4.pre.kind.still.many': { en: 'standing still', tr: 'duran görüntü' },
  'w4.pre.kind.repeat.many': { en: 'twice in a row', tr: 'art arda tekrar' }
} as const
