// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words of the dialogs and windows, moved onto the building blocks in
// phase 3c.4 (tarifler\FAZ3C.md "3c.4"; its first half, 3c.4a). Each key is
// written in both languages (decision 3: English is the default, Turkish is
// chosen in the settings); the type below asks for both and
// src/test/strings-3c4.test.ts checks it. The terms follow
// the glossary (scripts/i18n/terimler.mjs). Spread into STRINGS (ui/strings.ts).
// A file of its own, beside strings-3c.ts and strings-3c3.ts, because other
// phases were adding their words to those at the same time.

/** One text of phase 3c.4: English and Turkish both. */
interface Both {
  en: string
  tr: string
}

export const STRINGS_3C4 = {
  // ---- words many windows share ----------------------------------------------------
  'win.done': { en: 'Done', tr: 'Tamam' },
  'win.cancel': { en: 'Cancel', tr: 'Vazgeç' },
  'win.close': { en: 'Close', tr: 'Kapat' },

  // ---- keyboard shortcuts (components/app/dialogs.tsx) ------------------------------
  'win.keys.hint': { en: 'Click a shortcut, then press the keys you want. Esc cancels a rebind.', tr: 'Bir kısayola tıkla, sonra istediğin tuşlara bas. Esc yeniden atamayı iptal eder.' },
  'win.keys.press': { en: 'Press keys…', tr: 'Tuşlara bas…' },
  'win.keys.reset': { en: 'Reset to defaults', tr: 'Varsayılanlara dön' },
  'win.keys.of': { en: 'Shortcut of {action}', tr: '{action} kısayolu' },

  // ---- missing media -------------------------------------------------------------------
  'win.missing.one': { en: '{n} media file not found', tr: '{n} medya dosyası bulunamadı' },
  'win.missing.many': { en: '{n} media files not found', tr: '{n} medya dosyası bulunamadı' },
  'win.missing.why': { en: 'Moved, renamed, or on a drive that isn’t connected. The edit is intact: point each one at its file and everything built on it comes straight back.', tr: 'Taşınmış, adı değişmiş ya da bağlı olmayan bir sürücüde. Kurgu yerinde: her birini kendi dosyasına göster, üstüne kurulan her şey hemen geri gelir.' },
  'win.missing.locate': { en: 'Locate…', tr: 'Bul…' },
  'win.missing.locateOf': { en: 'Locate {name}', tr: '{name} dosyasını bul' },
  'win.missing.later': { en: 'You can also relink later from the link button beside a file in the media panel.', tr: 'Daha sonra medya panelinde dosyanın yanındaki bağlantı düğmesiyle de yeniden bağlayabilirsin.' },

  // ---- Shorts mode explainer -------------------------------------------------------------
  'win.mode.title': { en: 'Shorts mode: how it works', tr: 'Shorts modu: nasıl çalışır' },
  'win.mode.window': { en: 'The highlighted 9:16 window is what gets exported: a vertical 1080 × 1920 clip cut out of your 16:9 video, subtitles included.', tr: 'Vurgulu 9:16 pencere dışa aktarılan kısımdır: 16:9 videondan kesilen dikey bir 1080 × 1920 klip, altyazılar dahil.' },
  'win.mode.pan': { en: 'Drag the window left or right to frame the shot. To make it pan over time, add {kf} in the panel under the preview: one keyframe per position, and the window glides smoothly between them.', tr: 'Çekimi çerçevelemek için pencereyi sola ya da sağa sürükle. Zamanla kaymasını istersen önizlemenin altındaki panelde {kf} ekle: her konum için bir anahtar kare; pencere aralarında yumuşakça kayar.' },
  'win.mode.panKf': { en: 'pan keyframes', tr: 'kaydırma anahtar kareleri' },
  'win.mode.ok': { en: 'Got it', tr: 'Anladım' },

  // ---- the app's questions (App.tsx, AskDialog) ---------------------------------------------
  'win.ask.project': { en: 'Project', tr: 'Proje' },
  'win.ask.clips': { en: 'Clips', tr: 'Klipler' },
  'win.quit.title': { en: 'Save before quitting?', tr: 'Çıkmadan önce kaydedilsin mi?' },
  'win.quit.why': { en: 'This project has changes that haven’t been written to disk yet.', tr: 'Bu projede henüz diske yazılmamış değişiklikler var.' },
  'win.quit.save': { en: 'Save and quit', tr: 'Kaydet ve çık' },
  'win.quit.discard': { en: 'Discard', tr: 'Kaydetme' },
  'win.conflict.title': { en: 'The project file was changed', tr: 'Proje dosyası değişti' },
  'win.conflict.why': { en: 'Another program (for example a film tool) saved this project file after you opened it. Saving now writes your version over theirs.', tr: 'Sen açtıktan sonra başka bir program (örneğin bir film aracı) bu proje dosyasını kaydetti. Şimdi kaydetmek senin sürümünü onunkinin üstüne yazar.' },
  'win.conflict.file': { en: 'File', tr: 'Dosya' },
  'win.conflict.overwrite': { en: 'Overwrite it', tr: 'Üstüne yaz' },
  'win.recovery.title': { en: '{app} didn’t shut down cleanly', tr: '{app} düzgün kapanmadı' },
  'win.recovery.why': { en: 'An autosaved snapshot of your unsaved work is still here. Recover it, or discard it for good.', tr: 'Kaydedilmemiş işinin otomatik kaydedilmiş bir kopyası hâlâ burada. Kurtar ya da kalıcı olarak sil.' },
  'win.recovery.autosaved': { en: 'Autosaved', tr: 'Otomatik kayıt' },
  'win.recovery.note': { en: 'Discarding deletes the snapshot permanently.', tr: 'Silmek kopyayı kalıcı olarak yok eder.' },
  'win.recovery.discard': { en: 'Discard', tr: 'Sil' },
  'win.recovery.recover': { en: 'Recover', tr: 'Kurtar' },
  'win.recovery.later': { en: 'Later', tr: 'Sonra' },
  'win.srt.title': { en: 'How should the subtitles be timed?', tr: 'Altyazılar nasıl zamanlansın?' },
  'win.srt.why': { en: 'One cue per sentence reads naturally. One cue per word carries the timing at the resolution it was measured at, which is what another editor or a captioning tool wants when it is going to re-time or re-style them.', tr: 'Cümle başına bir satır doğal okunur. Kelime başına bir satır, zamanlamayı ölçüldüğü incelikte taşır: başka bir editör ya da altyazı aracı onları yeniden zamanlayacak ya da biçimlendirecekse istediği budur.' },
  'win.srt.sentences': { en: 'Sentences', tr: 'Cümleler' },
  'win.srt.words': { en: 'Word by word', tr: 'Kelime kelime' },
  'win.voiceSet.title': { en: 'Some subtitles have no word timings', tr: 'Bazı altyazıların kelime zamanlaması yok' },
  'win.voiceSet.why': { en: 'The word SRT is made from the timings of each word, and some of these subtitles do not carry them (typed or imported lines; Generate subtitles makes them). Those lines go into the word SRT as whole sentences. The sentence SRT and the MP3 are not affected.', tr: 'Kelime SRT’si her kelimenin zamanlamasından yapılır ve bu altyazıların bazıları bunu taşımıyor (yazılan ya da içe aktarılan satırlar; Altyazı üret bunları yapar). O satırlar kelime SRT’sine bütün cümle olarak girer. Cümle SRT’si ve MP3 etkilenmez.' },
  'win.voiceSet.export': { en: 'Export all three anyway', tr: 'Yine de üçünü dışa aktar' },
  'win.closeEsc': { en: 'Close (Esc)', tr: 'Kapat (Esc)' },

  // ---- the export window (components/ExportProgress.tsx) ------------------------------
  'win.export.failed': { en: 'Export failed', tr: 'Dışa aktarma başarısız' },
  'win.export.cancelled': { en: 'Export cancelled', tr: 'Dışa aktarma durduruldu' },
  'win.export.runningPct': { en: '{what}… {pct}%', tr: '{what}… %{pct}' },
  'win.export.video.running': { en: 'Exporting the video', tr: 'Video dışa aktarılıyor' },
  'win.export.video.done': { en: 'Video exported', tr: 'Video dışa aktarıldı' },
  'win.export.sound.running': { en: 'Exporting the sound', tr: 'Ses dışa aktarılıyor' },
  'win.export.sound.done': { en: 'Sound exported', tr: 'Ses dışa aktarıldı' },
  'win.export.shorts.running': { en: 'Exporting the Shorts', tr: 'Shorts dışa aktarılıyor' },
  'win.export.shorts.done': { en: 'Shorts exported', tr: 'Shorts dışa aktarıldı' },
  'win.export.frame.running': { en: 'Saving the frame', tr: 'Kare kaydediliyor' },
  'win.export.frame.done': { en: 'Frame saved', tr: 'Kare kaydedildi' },
  'win.export.srt.running': { en: 'Saving the subtitles', tr: 'Altyazılar kaydediliyor' },
  'win.export.srt.done': { en: 'Subtitles saved', tr: 'Altyazılar kaydedildi' },
  'win.export.voiceset.running': { en: 'Exporting the subtitles and the sound', tr: 'Altyazılar ve ses dışa aktarılıyor' },
  'win.export.voiceset.done': { en: 'Subtitles and sound exported', tr: 'Altyazılar ve ses dışa aktarıldı' },
  'win.export.eta': { en: '{pct}% · {left} left · done about {at}', tr: '%{pct} · {left} kaldı · bitiş yaklaşık {at}' },
  'win.export.pct': { en: '{pct}%', tr: '%{pct}' },
  'win.export.took': { en: 'took {t}', tr: '{t} sürdü' },
  'win.export.soFar': { en: '{t} so far', tr: 'şimdiye dek {t}' },
  'win.export.working': { en: 'working out the time left…', tr: 'kalan süre hesaplanıyor…' },
  'win.export.cancel.hint': { en: 'Stop this export (nothing is written)', tr: 'Bu dışa aktarmayı durdur (hiçbir şey yazılmaz)' },
  'win.export.folder': { en: 'Open folder', tr: 'Klasörü aç' },
  'win.export.folder.hint': { en: 'Show the file in Explorer', tr: 'Dosyayı Gezgin’de göster' },
  'win.export.play': { en: 'Play', tr: 'Oynat' },
  'win.export.play.hint': { en: 'Play it in your default player', tr: 'Varsayılan oynatıcında oynat' },

  // ---- before you export (components/Preflight.tsx) -------------------------------------
  'win.pre.loudAt': { en: 'A sudden loud peak at {at}', tr: '{at} anında ani bir yüksek ses tepesi' },
  'win.pre.clear': { en: 'All clear', tr: 'Her şey yolunda' },
  'win.pre.listening': { en: 'listening for loud peaks…', tr: 'yüksek ses tepeleri dinleniyor…' },
  'win.pre.go': { en: 'Go there', tr: 'Oraya git' },
  'win.pre.goTo': { en: 'Go to {at}', tr: '{at} anına git' },
  'win.pre.goSelect': { en: 'Go to {at} and select it', tr: '{at} anına git ve seç' },

  // ---- remove silence (components/SilenceCutter.tsx) ---------------------------------------
  'win.silence.title': { en: 'Remove silence', tr: 'Sessizliği kaldır' },
  'win.silence.noSound': { en: 'No selected clip has audible sound. Pick one or more audio clips, or a video with sound.', tr: 'Seçili kliplerin hiçbirinde duyulur ses yok. Bir ya da birkaç ses klibi ya da sesli bir video seç.' },
  'win.silence.red': { en: 'red', tr: 'kırmızı' },
  'win.silence.sensitivity': { en: 'Sensitivity', tr: 'Duyarlılık' },
  'win.silence.less': { en: 'Less', tr: 'Az' },
  'win.silence.balanced': { en: 'Balanced', tr: 'Dengeli' },
  'win.silence.more': { en: 'More', tr: 'Çok' },
  'win.silence.pace': { en: 'Pauses left', tr: 'Kalan duraklar' },
  'win.silence.tight': { en: 'Tight', tr: 'Sıkı' },
  'win.silence.tight.hint': { en: 'Jump cuts: a pause keeps little more than the pads.', tr: 'Atlamalı kesim: bir durak, kenar paylarından biraz fazlasını korur.' },
  'win.silence.natural': { en: 'Natural', tr: 'Doğal' },
  'win.silence.natural.hint': { en: 'Short pauses stay, long ones shrink to a breath.', tr: 'Kısa duraklar kalır, uzunlar bir nefese iner.' },
  'win.silence.relaxed': { en: 'Relaxed', tr: 'Rahat' },
  'win.silence.relaxed.hint': { en: 'Only the long hesitations get shorter.', tr: 'Yalnız uzun duraksamalar kısalır.' },
  'win.silence.analyzing': { en: 'Analyzing…', tr: 'İnceleniyor…' },
  'win.silence.none': { en: 'No silence found: try a higher sensitivity.', tr: 'Sessizlik bulunmadı: daha yüksek bir duyarlılık dene.' },
  'win.silence.failedOne': { en: '{n} audio clip could not be analysed; it will not be cut.', tr: '{n} ses klibi incelenemedi; kesilmeyecek.' },
  'win.silence.failedMany': { en: '{n} audio clips could not be analysed; they will not be cut.', tr: '{n} ses klibi incelenemedi; kesilmeyecekler.' },
  'win.silence.advanced': { en: 'Advanced', tr: 'Gelişmiş' },
  'win.silence.manual': { en: 'Manual threshold', tr: 'Elle eşik' },
  'win.silence.manual.hint': { en: 'Take over the automatic threshold. Anything quieter than this counts as silence, so lower it to stop audible passages being cut.', tr: 'Otomatik eşiği devral. Bundan sessiz olan her şey sessizlik sayılır; duyulur bölümlerin kesilmesini durdurmak için düşür.' },
  'win.silence.below': { en: 'Silence below dB', tr: 'Sessizlik eşiği dB' },
  'win.silence.autoOne': { en: 'Auto threshold:', tr: 'Otomatik eşik:' },
  'win.silence.autoMany': { en: 'Auto thresholds:', tr: 'Otomatik eşikler:' },
  'win.silence.db': { en: '{a} dB', tr: '{a} dB' },
  'win.silence.dbRange': { en: '{a} to {b} dB', tr: '{a} ile {b} dB arası' },
  'win.silence.override': { en: 'Switch to manual to override.', tr: 'Değiştirmek için elle eşiğe geç.' },
  'win.silence.pad': { en: 'Keep around speech ms', tr: 'Konuşma çevresinde kalan ms' },
  'win.silence.minGap': { en: 'Ignore gaps under s', tr: 'Şundan kısa boşlukları yok say (sn)' },
  'win.silence.crossfade': { en: 'Cross fade audio', tr: 'Sesi çapraz geçişle birleştir' },
  'win.silence.remove': { en: 'Remove', tr: 'Kaldır' },
  'win.silence.removedOne': { en: '{n} silent gap removed.', tr: '{n} sessiz boşluk kaldırıldı.' },
  'win.silence.removedMany': { en: '{n} silent gaps removed.', tr: '{n} sessiz boşluk kaldırıldı.' },

  // ---- clean the voice (components/CleanVoice.tsx, in the Clip tab) -------------------------
  'win.clean.sound': { en: 'Voice sound', tr: 'Ses tonu' },
  'win.clean.sound.hint': { en: 'A ready voice sound: it sets the EQ, the rumble cut and the compressor below', tr: 'Hazır bir ses tonu: aşağıdaki EQ’yu, uğultu kesiciyi ve sıkıştırıcıyı ayarlar' },
  'win.clean.noise': { en: 'Noise out', tr: 'Gürültü azalt' },
  'win.clean.ess': { en: 'Softer esses', tr: 'S seslerini yumuşat' },
  'win.clean.run': { en: 'Clean the voice', tr: 'Sesi temizle' },
  'win.clean.again': { en: 'Clean again', tr: 'Yeniden temizle' },
  'win.clean.busy': { en: 'Cleaning… {pct}%', tr: 'Temizleniyor… %{pct}' },
  'win.clean.run.hint': { en: 'Learns the noise from the quiet parts, takes it out and softens the esses, into a new file; nothing leaves this computer', tr: 'Gürültüyü sessiz yerlerden öğrenir, çıkarır ve s seslerini yumuşatır; yeni bir dosyaya yazar, hiçbir şey bu bilgisayardan çıkmaz' },
  'win.clean.original': { en: 'Original', tr: 'Özgün' },
  'win.clean.original.hint': { en: 'Back to the sound as it was recorded', tr: 'Sesin kaydedildiği hâline dön' },
  'win.clean.cleaned': { en: 'Cleaned: noise {noise}%, esses {ess}%. The original stays in the bin.', tr: 'Temizlendi: gürültü %{noise}, s sesleri %{ess}. Özgün dosya medya panelinde kalır.' },
  'win.clean.noExtract': { en: 'Could not take the sound out of this video to clean it', tr: 'Temizlemek için bu videonun sesi ayrılamadı' },
  'win.clean.unreadable': { en: 'The sound could not be read or written', tr: 'Ses okunamadı ya da yazılamadı' },
  'win.clean.done': { en: 'The voice is cleaned; the original is still in the bin', tr: 'Ses temizlendi; özgün dosya hâlâ medya panelinde' },
  'win.clean.failed': { en: 'Cleaning failed: {error}', tr: 'Temizleme başarısız: {error}' },

  // ---- beat sync (components/BeatSync.tsx, in the Look tab) ----------------------------------
  'win.beat.noMusic': { en: 'Put a music clip on an audio track: its beat can cut the pictures and time the transitions.', tr: 'Bir ses şeridine müzik klibi koy: ritmi görüntüleri kesebilir ve geçişleri zamanlayabilir.' },
  'win.beat.music': { en: 'Music', tr: 'Müzik' },
  'win.beat.musicItem': { en: '{name} · {s}s', tr: '{name} · {s} sn' },
  'win.beat.audio': { en: 'Audio', tr: 'Ses' },
  'win.beat.listening': { en: 'Listening…', tr: 'Dinleniyor…' },
  'win.beat.find': { en: 'Find the beat', tr: 'Ritmi bul' },
  'win.beat.again': { en: '{bpm} BPM · {n} beats, find again', tr: '{bpm} BPM · {n} vuruş, yeniden bul' },
  'win.beat.none': { en: 'No beat found in that music.', tr: 'O müzikte ritim bulunamadı.' },
  'win.beat.cut': { en: 'Cut', tr: 'Kes' },
  'win.beat.every': { en: 'Every', tr: 'Her' },
  'win.beat.beatOne': { en: '{n} beat', tr: '{n} vuruş' },
  'win.beat.beatMany': { en: '{n} beats', tr: '{n} vuruş' },
  'win.beat.cutOn': { en: 'Cut on the beat', tr: 'Ritimde kes' },
  'win.beat.cutDone': { en: '{n} pictures cut on the beat.', tr: '{n} görüntü ritimde kesildi.' },
  'win.beat.cutNone': { en: 'Nothing to cut on that track.', tr: 'O şeritte kesilecek bir şey yok.' },
  'win.beat.trans': { en: 'Transitions on the beat', tr: 'Geçişler ritimde' },
  'win.beat.transDone': { en: '{n} transitions moved onto the beat.', tr: '{n} geçiş ritme taşındı.' },
  'win.beat.transNone': { en: 'Every transition is on the beat already.', tr: 'Her geçiş zaten ritimde.' },
  'win.beat.bars': { en: 'Mark the bars on the timeline', tr: 'Ölçüleri çizelgede işaretle' },
  'win.beat.bars.hint': { en: 'A marker on every fourth beat (the bar), to cut to by hand', tr: 'Her dördüncü vuruşa (ölçü) bir işaret: elle kesmek için' },
  'win.beat.how': { en: 'The beat is found from the music itself. Cut on the beat retimes the track’s pictures in order from its first one; Transitions on the beat rolls each cut that has a transition to the nearest beat.', tr: 'Ritim müziğin kendisinden bulunur. Ritimde kes, şeridin görüntülerini ilkinden başlayarak sırayla yeniden zamanlar; Geçişler ritimde, geçişi olan her kesimi en yakın vuruşa kaydırır.' },
} satisfies Record<string, Both>
