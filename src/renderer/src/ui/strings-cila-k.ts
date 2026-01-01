// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words of cila K (SnippStudio CILA-K-PLAN.md): "code values", the panel
// where the constants the app found in a code clip's page (colours, texts,
// fonts, times) are changed by hand (components/codevalues/), and its one
// button in the Inspector's code clip part. Each key in both languages
// (English is the default, Turkish is chosen in the settings); the type below
// asks for both and src/test/strings-cila-k.test.ts checks it. Spread into
// STRINGS (ui/strings.ts). None of these words is ever said to an agent.

/** One text of cila K: English and Turkish both. */
interface Both {
  en: string
  tr: string
}

export const STRINGS_CILA_K = {
  // ---- the Inspector's button (components/inspector/CodeFilmParams.tsx) --------------
  'codeval.open': { en: 'Edit values', tr: 'Değerleri düzenle' },
  'codeval.open.count': { en: 'Edit values ({n} changed)', tr: 'Değerleri düzenle ({n} değişti)' },
  'codeval.open.hint': {
    en: 'The colors, texts, fonts and times found in this page’s code, changed by hand in a side panel. The files are not touched.',
    tr: 'Bu sayfanın kodunda bulunan renkler, metinler, yazı tipleri ve süreler; yan panelde elle değiştirilir. Dosyalara dokunulmaz.'
  },
  // ---- the panel (components/codevalues/CodeValuesPanel.tsx) ----------------------------
  'codeval.title': { en: 'Code values', tr: 'Kod değerleri' },
  'codeval.close': { en: 'Close', tr: 'Kapat' },
  'codeval.film': { en: 'Page: {name}', tr: 'Sayfa: {name}' },
  'codeval.search': { en: 'Search a value or a file', tr: 'Değer ya da dosya ara' },
  'codeval.onlyChanged': { en: 'Only changed', tr: 'Yalnız değiştirilenler' },
  'codeval.scanning': { en: 'Reading the page’s files…', tr: 'Sayfanın dosyaları okunuyor…' },
  'codeval.failed': { en: 'The page’s files could not be read.', tr: 'Sayfanın dosyaları okunamadı.' },
  'codeval.empty': { en: 'No constant that can be changed was found in this page.', tr: 'Bu sayfada değiştirilebilir sabit bulunamadı.' },
  'codeval.noMatch': { en: 'Nothing matches.', tr: 'Eşleşen yok.' },
  'codeval.skipped': { en: '{n} file(s) {n|was|were} not read: longer than 1 MB, or past the folder’s first 2 MB of code.', tr: '{n} dosya okunmadı: 1 MB’tan uzun, ya da klasördeki kodun ilk 2 MB’ından sonra.' },
  'codeval.more': { en: '{n} more: narrow the list with the search.', tr: '{n} tane daha: listeyi aramayla daraltın.' },
  'codeval.kind.color': { en: 'Colors', tr: 'Renkler' },
  'codeval.kind.text': { en: 'Texts', tr: 'Metinler' },
  'codeval.kind.font': { en: 'Fonts', tr: 'Yazı tipleri' },
  'codeval.kind.time': { en: 'Times', tr: 'Süreler' },
  'codeval.places': { en: '{n} places', tr: '{n} yerde' },
  'codeval.places.hint': { en: 'Show each place and change it on its own', tr: 'Yerleri tek tek göster ve ayrı ayrı değiştir' },
  'codeval.where': { en: '{file}, line {line}', tr: '{file}, {line}. satır' },
  'codeval.in.css': { en: 'style sheet', tr: 'stil' },
  'codeval.in.style': { en: 'style attribute', tr: 'stil özniteliği' },
  'codeval.in.attr': { en: 'attribute', tr: 'öznitelik' },
  'codeval.in.html': { en: 'page text', tr: 'sayfa metni' },
  'codeval.in.js': { en: 'script', tr: 'betik' },
  'codeval.mixed': { en: 'different values', tr: 'farklı değerler' },
  'codeval.changed': { en: 'changed', tr: 'değişti' },
  'codeval.own': { en: 'The page’s own: {value}', tr: 'Sayfanın kendi değeri: {value}' },
  'codeval.reset': { en: 'Back to the page’s own value', tr: 'Sayfanın kendi değerine dön' },
  'codeval.resetAll': { en: 'Reset all', tr: 'Tümünü sıfırla' },
  'codeval.resetAll.hint': { en: 'Back to the page’s own values', tr: 'Sayfanın kendi değerlerine dön' },
  'codeval.color.pick': { en: 'Pick the color', tr: 'Rengi seç' },
  'codeval.color.value': { en: 'Color (#rrggbb or #rrggbbaa)', tr: 'Renk (#rrggbb ya da #rrggbbaa)' },
  'codeval.text.value': { en: 'Text', tr: 'Metin' },
  'codeval.font.value': { en: 'Font', tr: 'Yazı tipi' },
  'codeval.font.page': { en: 'In this page', tr: 'Bu sayfada' },
  'codeval.font.installed': { en: 'On this computer', tr: 'Bu bilgisayarda' },
  'codeval.time.value': { en: 'Time', tr: 'Süre' },
  'codeval.refused.alpha': { en: 'A transparency cannot be written where the color is a number (0xRRGGBB): {n} place(s) {n|keeps|keep} the page’s own.', tr: 'Rengin sayı olarak yazıldığı yere (0xRRGGBB) saydamlık yazılamaz: {n} yer sayfanın kendi değerinde kalıyor.' },
  'codeval.refused.font': { en: 'This name needs quote marks that cannot be written here: {n} place(s) {n|keeps|keep} the page’s own.', tr: 'Bu ad buraya yazılamayan tırnak işaretleri gerektiriyor: {n} yer sayfanın kendi değerinde kalıyor.' },
  'codeval.refused.other': { en: 'Cannot be written at {n} place(s): {n|it keeps|they keep} the page’s own.', tr: '{n} yere yazılamıyor: sayfanın kendi değerinde kalıyorlar.' },
  'codeval.gone.title': { en: 'No longer in the page ({n})', tr: 'Sayfada artık yok ({n})' },
  'codeval.gone.note': { en: 'The files were rewritten: these changes have no place any more and are not applied.', tr: 'Dosyalar yeniden yazıldı: bu değişikliklerin artık yeri yok, uygulanmıyorlar.' },
  'codeval.gone.discard': { en: 'Discard', tr: 'At' },
  'codeval.gone.discardAll': { en: 'Discard all', tr: 'Hepsini at' },
  'codeval.write': { en: 'Write to the files', tr: 'Dosyaya işle' },
  'codeval.write.hint': {
    en: 'Writes the changes into the page’s own files and empties this list. The files as they are now are kept as a version first (“Back to the previous version” brings them back).',
    tr: 'Değişiklikleri sayfanın kendi dosyalarına yazar ve bu listeyi boşaltır. Önce dosyaların şimdiki hâli sürüm olarak saklanır (“Önceki sürüme dön” geri getirir).'
  },
  'codeval.write.off': {
    en: 'Only a code clip’s own folder (anim\\<name> beside the saved project), whose versions are kept, is written to. Here the changes stay in the project.',
    tr: 'Yalnız kod klibinin kendi klasörüne (kayıtlı projenin yanındaki anim\\<ad>; sürümleri tutulur) yazılır. Burada değişiklikler projede kalır.'
  },
  'codeval.write.done': { en: 'Written: {places} place(s) in {files} file(s). The files as they were are version {n}.', tr: 'Yazıldı: {files} dosyada {places} yer. Dosyaların önceki hâli {n}. sürüm.' },
  'codeval.write.doneKept': { en: 'Written: {places} place(s) in {files} file(s). The files as they were are already kept as a version.', tr: 'Yazıldı: {files} dosyada {places} yer. Dosyaların önceki hâli zaten bir sürüm olarak saklı.' },
  'codeval.write.overLimit': { en: 'Not written: the files are over the 2 MB a version keeps, so the state before could not be kept.', tr: 'Yazılmadı: dosyalar bir sürümün tuttuğu 2 MB’ı aşıyor, önceki hâl saklanamadı.' },
  'codeval.write.gone': { en: 'Not written: none of the changes has a place in the files any more.', tr: 'Yazılmadı: değişikliklerin hiçbirinin dosyalarda artık yeri yok.' },
  'codeval.write.changed': { en: 'Not written: a file changed while its values were being written. Try again.', tr: 'Yazılmadı: değerler yazılırken bir dosya değişti. Yeniden deneyin.' },
  'codeval.write.failed': { en: 'Not written: {why}', tr: 'Yazılmadı: {why}' }
} satisfies Record<string, Both>
