// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Çekirdek cila S: the words of "Remove silence" as it now decides what to
// listen to and what to cut, and of the transcript panel's fillers, repeats,
// pauses and selection actions. English and Turkish, the same parameters
// (src/test/strings-cila-s.test.ts). Spread into STRINGS by ui/strings.ts.
export const STRINGS_CILA_S = {
  // ---- what a cut leaves alone (the window and the transcript) --------------
  'cs.keepMusic': { en: 'Do not cut music and other sounds', tr: 'Müzik ve diğer sesler kesilmesin' },
  'cs.keepMusic.hint': {
    en: 'A sound track that holds none of the clips listened to (music, room tone) is not cut and does not move. Off: every unlocked track is cut.',
    tr: 'Dinlenen kliplerden hiçbirini taşımayan ses şeridi (müzik, ortam sesi) kesilmez ve kaymaz. Kapalıyken kilitsiz her şerit kesilir.'
  },
  'cs.endBeds': { en: 'End the music at the new end', tr: 'Müziği yeni sonda bitir' },
  'cs.endBeds.hint': {
    en: 'Music that would run on past the shortened film is cut back to its new end and fades out there (its own fade-out, or 1 s).',
    tr: 'Kısalan filmin sonundan taşacak müzik yeni sonda kesilir ve orada kısılarak biter (kendi kısılması, yoksa 1 sn).'
  },

  // ---- Remove silence -------------------------------------------------------
  'cs.silence.listen.speech': { en: 'Nothing is picked: listening to the speech ({tracks}).', tr: 'Seçim yok: konuşma dinleniyor ({tracks}).' },
  'cs.silence.listen.one': { en: 'Listening to {name}.', tr: '{name} dinleniyor.' },
  'cs.silence.listen.many': { en: 'Listening to {n} clips: a pause is cut only where all of them are quiet.', tr: '{n} klip dinleniyor: bir duraklama yalnız hepsinin sustuğu yerde kesilir.' },
  'cs.silence.limit.marks': { en: 'Only between the two cut marks ({a} to {b}).', tr: 'Yalnız iki kesim işaretinin arası ({a} – {b}).' },
  'cs.silence.limit.loop': { en: 'Only inside the loop range ({a} to {b}).', tr: 'Yalnız döngü aralığının içi ({a} – {b}).' },
  'cs.silence.red': { en: 'Cuts show {red}; nothing is cut before Remove.', tr: 'Kesilecekler {red} görünür; Kaldır’a dek kesilmez.' },
  'cs.silence.noSpeech': {
    en: 'No clip is known to be the speech (no subtitles, and no single track of talking pictures). Pick the clip to listen to: an audio clip, a video with sound, or several (Ctrl+click).',
    tr: 'Hangi klibin konuşma olduğu bilinmiyor (altyazı yok, konuşan görüntü tek bir şeritte değil). Dinlenecek klibi seç: bir ses klibi, sesli bir video ya da birkaçı (Ctrl+tık).'
  },
  'cs.silence.finding': { en: 'Finding the speech…', tr: 'Konuşma aranıyor…' },
  'cs.silence.status.one': { en: '{n} pause · {s} s will be cut.', tr: '{n} duraklama · {s} sn kesilecek.' },
  'cs.silence.status.many': { en: '{n} pauses · {s} s will be cut.', tr: '{n} duraklama · {s} sn kesilecek.' },
  'cs.silence.unsure': { en: 'Cut the uncertain ones too ({n})', tr: 'Emin olunmayanları da kes ({n})' },
  'cs.silence.unsure.hint': {
    en: 'Not surely a pause: it reaches into a subtitle word, or another clip is as loud as speech under it. Left in unless you switch this on.',
    tr: 'Duraklama olduğu kesin değil: bir altyazı kelimesine giriyor ya da altında başka bir klip konuşma düzeyinde. Bunu açmadıkça kesilmez.'
  },
  'cs.silence.unsure.word': { en: '{n} reach into a subtitle word', tr: '{n} tanesi bir altyazı kelimesine giriyor' },
  'cs.silence.unsure.voice': { en: '{n} have another clip at speech level under them', tr: '{n} tanesinin altında konuşma düzeyinde başka bir klip var' },
  'cs.silence.markOnly': { en: 'Only mark', tr: 'Yalnız işaretle' },
  'cs.silence.markOnly.hint': { en: 'Cut nothing: leave a marker at the start of each pause (one undo step).', tr: 'Hiçbir şeyi kesme: her duraklamanın başına bir işaretçi bırak (tek geri alma adımı).' },
  'cs.silence.marker': { en: 'Pause {s} s', tr: 'Duraklama {s} sn' },
  'cs.silence.markedOne': { en: '{n} pause marked.', tr: '{n} duraklama işaretlendi.' },
  'cs.silence.markedMany': { en: '{n} pauses marked.', tr: '{n} duraklama işaretlendi.' },

  // ---- the transcript panel ---------------------------------------------------
  'cs.script.fillers.hint': { en: 'Fillers: find the filler sounds (ee, um…) and choose which to cut', tr: 'Dolgu sesleri: ee, ıı gibi sesleri bul ve hangilerinin kesileceğini seç' },
  'cs.script.repeats.hint': { en: 'Repeats: find sentences said twice and choose which first takes to cut', tr: 'Tekrarlar: iki kez söylenen cümleleri bul ve hangi ilk denemelerin kesileceğini seç' },
  'cs.script.review.fillers.one': { en: '{n} filler sound', tr: '{n} dolgu sesi' },
  'cs.script.review.fillers.many': { en: '{n} filler sounds', tr: '{n} dolgu sesi' },
  'cs.script.review.repeats.one': { en: '{n} sentence said twice (the earlier take is cut)', tr: '{n} cümle iki kez söylenmiş (ilk deneme kesilir)' },
  'cs.script.review.repeats.many': { en: '{n} sentences said twice (the earlier take is cut)', tr: '{n} cümle iki kez söylenmiş (ilk deneme kesilir)' },
  'cs.script.review.none.fillers': { en: 'No filler sound found.', tr: 'Dolgu sesi bulunmadı.' },
  'cs.script.review.none.repeats': { en: 'No sentence said twice found.', tr: 'İki kez söylenen cümle bulunmadı.' },
  'cs.script.review.listening': { en: 'Listening for sounds with no word…', tr: 'Kelimesi yazılmamış sesler aranıyor…' },
  'cs.script.review.all': { en: 'All', tr: 'Hepsi' },
  'cs.script.review.none': { en: 'None', tr: 'Hiçbiri' },
  'cs.script.review.play': { en: 'Play it', tr: 'Oynat' },
  'cs.script.review.pick': { en: 'Cut {what}', tr: '{what}: kes' },
  'cs.script.review.cut.one': { en: 'Cut {n} ({s} s)', tr: '{n} tanesini kes ({s} sn)' },
  'cs.script.review.cut.many': { en: 'Cut {n} ({s} s)', tr: '{n} tanesini kes ({s} sn)' },
  'cs.script.review.unsure': { en: 'not sure', tr: 'emin değil' },
  'cs.script.review.words': { en: 'Words you count as filler too', tr: 'Senin de dolgu saydığın kelimeler' },
  'cs.script.why.mark': { en: 'said with ! or ?', tr: '! ya da ? ile söylenmiş' },
  'cs.script.why.word': { en: 'also a word', tr: 'aynı zamanda bir kelime' },
  'cs.script.why.quotes': { en: 'in quotes', tr: 'tırnak içinde' },
  'cs.script.why.capital': { en: 'a capital inside a sentence (a name?)', tr: 'cümle içinde büyük harf (bir ad?)' },
  'cs.script.why.answer': { en: 'alone after a question (an answer?)', tr: 'bir sorudan sonra tek başına (cevap?)' },
  'cs.script.why.opens': { en: 'opens a sentence that ends with ! or ?', tr: '! ya da ? ile biten bir cümleyi açıyor' },
  'cs.script.why.goesOn': { en: 'the sentence goes on after it', tr: 'cümle ondan sonra sürüyor' },
  'cs.script.why.guessed': { en: 'its time is a guess (no word times)', tr: 'zamanı tahmin (kelime zamanı yok)' },
  'cs.script.why.island': { en: 'a sound with no word written', tr: 'kelimesi yazılmamış bir ses' },
  'cs.script.why.repeat': { en: 'not surely a retake', tr: 'tekrar olduğu kesin değil' },
  'cs.script.pause': { en: '[{s} s]', tr: '[{s} sn]' },
  'cs.script.pause.hint': { en: 'A pause of {s} s. Select it and delete: it is cut down to a breath.', tr: '{s} sn’lik duraklama. Seçip sil: bir nefes kalacak kadar kısalır.' },
  'cs.script.deletePause.one': { en: 'Cut {s} s of {n} pause — or press Del', tr: '{n} duraklamadan {s} sn kes — ya da Del’e bas' },
  'cs.script.deletePause.many': { en: 'Cut {s} s of {n} pauses — or press Del', tr: '{n} duraklamadan {s} sn kes — ya da Del’e bas' },
  'cs.script.marker.hint': { en: 'Marker here: leave a marker at the start of the selection', tr: 'İşaretçi koy: seçimin başına bir işaretçi bırak' },
  'cs.script.range.hint': { en: 'Make a range: the selection becomes a Shorts range (it can be exported on its own)', tr: 'Aralığı seç: seçim bir Shorts aralığı olur (tek başına dışa aktarılabilir)' },
  'cs.script.marked': { en: 'Marker at {t}.', tr: '{t} anına işaretçi kondu.' },
  'cs.script.ranged': { en: 'Range {a} to {b} made.', tr: '{a} – {b} aralığı oluşturuldu.' },
  'cs.script.vtt.hint': { en: 'Save the subtitles as a WebVTT (.vtt) file', tr: 'Altyazıları WebVTT (.vtt) dosyası olarak kaydet' },
  'cs.script.vtt.saved': { en: 'Saved {name}.', tr: '{name} kaydedildi.' },
  'cs.script.vtt.failed': { en: 'Could not write the .vtt file.', tr: '.vtt dosyası yazılamadı.' }
} as const
