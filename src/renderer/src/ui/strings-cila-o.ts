// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words of cila O and E (SnippStudio CILA-O-PLAN.md): "Fit to voice" in the
// Media panel (components/FitVoiceDialog.tsx) and the encoder choice in the
// export window (components/ExportWindow.tsx). Each key in both languages
// (English is the default, Turkish is chosen in the settings); the type below
// asks for both and src/test/strings-cila-o.test.ts checks it. The terms follow
// the glossary (scripts/i18n/terimler.mjs). Spread into STRINGS (ui/strings.ts).

/** One text of cila O: English and Turkish both. */
interface Both {
  en: string
  tr: string
}

export const STRINGS_CILA_O = {
  // ---- Fit to voice (components/MediaBin.tsx, components/FitVoiceDialog.tsx) --------
  'fit.open.count': { en: 'Fit to voice ({n})', tr: 'Sese diz ({n})' },
  'fit.open.hint': { en: 'Lay the selected pictures on the voice, on a new layer (one undo step)', tr: 'Seçili görselleri sese diz, yeni bir katmana (tek geri alma adımı)' },
  'fit.title': { en: 'Fit pictures to the voice', tr: 'Görselleri sese diz' },
  'fit.mode': { en: 'How', tr: 'Nasıl' },
  'fit.mode.numbers': { en: 'By subtitle numbers', tr: 'Altyazı numaralarına göre' },
  'fit.mode.numbers.hint': { en: 'Picture 3 on subtitle line 3 (the first number in its file name), held until the next line starts', tr: '3 numaralı görsel 3. altyazı satırına (dosya adındaki ilk sayı); bir sonraki satır başlayana kadar durur' },
  'fit.mode.even': { en: 'Evenly spaced', tr: 'Eşit aralıkla' },
  'fit.mode.even.hint': { en: 'The pictures in name order, in equal parts over the voice (to the end of the last subtitle line, else over the sound tracks’ clips)', tr: 'Görseller ad sırasıyla, sese eşit bölünür (son altyazı satırının sonuna kadar; altyazı yoksa ses şeritlerindeki kliplere)' },
  'fit.mode.range': { en: 'Into the selected range', tr: 'Seçili aralığa' },
  'fit.mode.range.hint': { en: 'The pictures in name order, in equal parts over the range: the in and out points (I / O), else the loop, else two cut marks, else the selected clips', tr: 'Görseller ad sırasıyla, aralığa eşit bölünür: giriş ve çıkış noktaları (I / O), yoksa döngü, yoksa iki kesim işareti, yoksa seçili klipler' },
  'fit.ready': { en: '{n} picture(s) from {from} to {to}, on a new layer.', tr: '{n} görsel, {from} – {to}, yeni bir katmanda.' },
  'fit.ready.missing': { en: '{n} picture(s) and {missing} empty slot(s) for missing numbers, from {from} to {to}, on a new layer.', tr: '{n} görsel ve eksik numaralar için {missing} boş yer, {from} – {to}, yeni bir katmanda.' },
  'fit.skipped': { en: '{n} picture(s) left out: no number in the name, a number past the last subtitle line, or a number already taken.', tr: '{n} görsel dışarıda kaldı: adında sayı yok, sayısı son altyazı satırını geçiyor ya da o sayı alınmış.' },
  'fit.block.noPictures': { en: 'No picture is selected.', tr: 'Seçili görsel yok.' },
  'fit.block.noSubtitles': { en: 'There are no subtitles yet: make them from the voice first (Inspector → Subs).', tr: 'Henüz altyazı yok: önce sesten altyazı üret (Özellikler → Altyazı).' },
  'fit.block.noNumbers': { en: 'None of the selected pictures has a number in its name that matches a subtitle line.', tr: 'Seçili görsellerin hiçbirinin adında bir altyazı satırına denk gelen sayı yok.' },
  'fit.block.noVoice': { en: 'No voice to fit to: no subtitles and nothing on the sound tracks.', tr: 'Dizilecek ses yok: altyazı yok, ses şeritlerinde de bir şey yok.' },
  'fit.block.noRange': { en: 'No range is selected: set in and out points (I / O) or two cut marks, or select clips.', tr: 'Seçili aralık yok: giriş ve çıkış noktası (I / O) ya da iki kesim işareti koy veya klip seç.' },
  'fit.block.tooShort': { en: 'Too many pictures for this length: each would be shorter than a tenth of a second.', tr: 'Bu uzunluk için görsel çok fazla: her biri saniyenin onda birinden kısa kalırdı.' },
  'fit.failed': { en: 'The project changed under the window; nothing was placed. Try again.', tr: 'Pencere açıkken proje değişti; hiçbir şey yerleştirilmedi. Yeniden dene.' },
  'fit.apply': { en: 'Place {n}', tr: '{n} yerleştir' },
  'fit.cancel': { en: 'Cancel', tr: 'Vazgeç' },
  'fit.done': { en: '{n} picture(s) on {track}. Ctrl+Z undoes it.', tr: '{track} şeridinde {n} görsel. Ctrl+Z geri alır.' },

  // ---- the encoder choice (components/ExportWindow.tsx) ----------------------------
  'export.encoderChoice': { en: 'Encoder', tr: 'Kodlayıcı' },
  'export.encoderChoice.auto': { en: 'Automatic', tr: 'Otomatik' },
  'export.encoderChoice.auto.hint': { en: 'The graphics card’s encoder when it takes the choice, else the software one', tr: 'Ekran kartının kodlayıcısı seçimi kabul ediyorsa o, yoksa yazılım kodlayıcısı' },
  'export.encoderChoice.software': { en: 'Software', tr: 'Yazılım' },
  'export.encoderChoice.software.hint': { en: 'Never the graphics card: slower, the same picture. For a driver that fails or a file that must be the same on every computer', tr: 'Ekran kartı hiç kullanılmaz: daha yavaş, aynı görüntü. Hata veren bir sürücü ya da her bilgisayarda aynı olması gereken bir dosya için' },
  'export.encoder.softwareChosen': { en: 'Encoder: software (chosen), slower', tr: 'Kodlayıcı: yazılım (seçildi), daha yavaş' }
} satisfies Record<string, Both>
