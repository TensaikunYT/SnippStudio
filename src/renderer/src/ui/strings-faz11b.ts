// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11b (the fix round): the words it added, English and Turkish, the
// same parameters. Spread into STRINGS by ui/strings.ts. FAZ11-PLAN.md "11b".
export const STRINGS_FAZ11B = {
  // ---- the user's request: one click points at a place (a numbered pin) ----
  'notes.draw.pin': { en: 'Pin', tr: 'İşaret' },
  'notes.draw.pin.hint': { en: 'Click where you mean: a numbered pin (a click with any tool puts one too)', tr: 'Kastettiğin yere tıkla: numaralı bir işaret (hangi araçla tıklarsan tıkla işaret koyar)' },
  'notes.point': { en: 'Point', tr: 'Göster' },
  'notes.point.hint': { en: 'Click the preview to start a note on that frame with pin 1; each click adds the next number', tr: 'Önizlemede bir yere tıkla: o karede 1 numaralı işaretiyle yeni bir not başlar; her tık bir sonraki numarayı koyar' },
  // ---- U4: the folder a video was to be written to is not there --------------
  'export.disk.gone': { en: 'The folder chosen for the video is not there any more (a drive taken out, a folder moved or deleted). Choose another place, then export again.', tr: 'Video için seçilen klasör artık yok (çıkarılmış bir sürücü, taşınmış ya da silinmiş bir klasör). Başka bir yer seçin, sonra yeniden dışa aktarın.' },
  'export.disk.gone.file': { en: 'The folder chosen for the file is not there any more (a drive taken out, a folder moved or deleted). Choose another place, then export again.', tr: 'Dosya için seçilen klasör artık yok (çıkarılmış bir sürücü, taşınmış ya da silinmiş bir klasör). Başka bir yer seçin, sonra yeniden dışa aktarın.' },
  // ---- U8: the placeholder of "+ Text" ---------------------------------------
  'caption.newText': { en: 'New text', tr: 'Yeni yazı' },
  // ---- U9: a percentage in the window's language ("45%", "%45") -------------
  'ui.percent': { en: '{n}%', tr: '%{n}' },
  // ---- D24: "Back to the previous version" asks first --------------------------
  'codeFilm.versionBack.ask': { en: 'Put the files of version {n} back in place of the code clip’s files as they are now?', tr: 'Kod klibinin dosyalarının şimdiki hâlinin yerine {n}. sürümün dosyaları konsun mu?' },
  'codeFilm.versionBack.note': { en: 'The files as they are now are kept as a version in the clip’s .surumler folder; this button goes further back, not forward again. Versions keep the text files only: pictures and sounds in the folder stay as they are.', tr: 'Dosyaların şimdiki hâli klibin .surumler klasöründe sürüm olarak saklanır; bu düğme daha geriye gider, ileri dönmez. Sürümler yalnız metin dosyalarını tutar: klasördeki resim ve sesler olduğu gibi kalır.' },
  'codeFilm.versionBack.do': { en: 'Put back', tr: 'Geri koy' },
  'codeFilm.versionBack.keep': { en: 'Keep the files', tr: 'Dosyaları tut' },
  // ---- C20: "Make subtitles" over subtitles already there ----------------------
  'agent.ready.subtitles.replace': { en: 'The project has {n} subtitle lines. Making them again replaces them, your own corrections too (Ctrl+Z brings them back).', tr: 'Projede {n} altyazı satırı var. Yeniden üretmek onların yerine geçer, senin düzeltmelerin de gider (Ctrl+Z geri getirir).' },
  'agent.ready.subtitles.again': { en: 'Make them again', tr: 'Yeniden üret' },
  'agent.ready.subtitles.keep': { en: 'Keep these', tr: 'Bunları tut' },
  // ---- C19: "Even out the loudness" past its first 40 clips -------------------
  'agent.ready.loudness.skipped': { en: '{n} more sound clips were left as they are (it evens out the first 40).', tr: '{n} ses klibi daha olduğu gibi bırakıldı (ilk 40 klibi eşitler).' },
} as const
