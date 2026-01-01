// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words of the interface audit patch, worker B (tarifler\YAMA-ARAYUZ.md
// "İşçi B": the shell, the language, the windows, number and time formats,
// the building blocks). Each key in both languages (English is the default,
// Turkish is chosen in File → Language); src/test/strings-all.test.ts checks
// it. Spread into STRINGS (ui/strings.ts). A file of its own, because worker A
// adds its words at the same time.

/** One text: English and Turkish both. */
interface Both {
  en: string
  tr: string
}

export const STRINGS_YAMA_B = {
  // ---- E1: the language, in the File menu (components/TopBar.tsx) ------------
  // Each language is named in its own words, in both interfaces (the way a
  // reader of the other one finds it).
  'top.file.langHead': { en: 'Language', tr: 'Dil' },
  'top.file.lang.en': { en: 'English', tr: 'English' },
  'top.file.lang.tr': { en: 'Türkçe', tr: 'Türkçe' },
  'top.file.lang.hint': { en: 'The language of the interface. Kept for the next start.', tr: 'Arayüzün dili. Bir sonraki açılışta da kalır.' },

  // ---- G6 / G7: numbers and times (ui/format.ts) ------------------------------
  'fmt.seconds': { en: '{n} s', tr: '{n} sn' },

  // ---- E6: the Projects window's cards (components/ProjectHome.tsx) ----------
  'home.openCard': { en: 'Open {name}', tr: '{name} projesini aç' },

  // ---- E8: the Shortcuts window's actions and keys (shortcuts.ts) ----------------
  'keys.act.playPause': { en: 'Play / Pause', tr: 'Oynat / Duraklat' },
  'keys.act.delete': { en: 'Delete selection / cut region', tr: 'Seçimi ya da kesim aralığını sil' },
  'keys.act.split': { en: 'Split at playhead', tr: 'Oynatma çizgisinde böl' },
  'keys.act.splitTool': { en: 'Split tool (click a clip to split there)', tr: 'Bölme aracı (bir klibe tıkla, orada böler)' },
  'keys.act.slipTool': { en: 'Slip tool (drag a clip to slide its footage)', tr: 'Kaydırma aracı (klibi sürükle, görüntüsü içinde kayar)' },
  'keys.act.cutter': { en: 'Toggle cutter tool', tr: 'Kesici aracını aç / kapat' },
  'keys.act.selectTool': { en: 'Selection tool', tr: 'Seçim aracı' },
  'keys.act.selectAll': { en: 'Select everything on the timeline', tr: 'Çizelgedeki her şeyi seç' },
  'keys.act.undo': { en: 'Undo', tr: 'Geri al' },
  'keys.act.redo': { en: 'Redo', tr: 'Yinele' },
  'keys.act.save': { en: 'Save project', tr: 'Projeyi kaydet' },
  'keys.act.goStart': { en: 'Go to start', tr: 'Başa git' },
  'keys.act.frameBack': { en: 'Step back one frame', tr: 'Bir kare geri' },
  'keys.act.frameForward': { en: 'Step forward one frame', tr: 'Bir kare ileri' },
  'keys.act.secondBack': { en: 'Jump back 1 second', tr: '1 saniye geri atla' },
  'keys.act.secondForward': { en: 'Jump forward 1 second', tr: '1 saniye ileri atla' },
  'keys.act.nudgeLeft': { en: 'Nudge selected clips left 1 frame', tr: 'Seçili klipleri 1 kare sola it' },
  'keys.act.nudgeRight': { en: 'Nudge selected clips right 1 frame', tr: 'Seçili klipleri 1 kare sağa it' },
  'keys.act.shortIn': { en: 'In point: the export range (in Shorts mode, the Short segment)', tr: 'Giriş noktası: dışa aktarma aralığı (Shorts kipinde Shorts bölümü)' },
  'keys.act.shortOut': { en: 'Out point: the export range (in Shorts mode, the Short segment)', tr: 'Çıkış noktası: dışa aktarma aralığı (Shorts kipinde Shorts bölümü)' },
  'keys.act.zoomFit': { en: 'Zoom to fit whole project', tr: 'Bütün projeyi sığdır' },
  'keys.act.zoomSelection': { en: 'Zoom to selected clips', tr: 'Seçili kliplere yakınlaş' },
  'keys.act.prevEdit': { en: 'Jump to previous edit point', tr: 'Önceki kesim noktasına atla' },
  'keys.act.nextEdit': { en: 'Jump to next edit point', tr: 'Sonraki kesim noktasına atla' },
  'keys.act.toggleLoop': { en: 'Loop the marked range', tr: 'İşaretli aralığı döngüye al' },
  'keys.act.nextMarker': { en: 'Jump to next marker', tr: 'Sonraki işaretleyiciye atla' },
  'keys.act.prevMarker': { en: 'Jump to previous marker', tr: 'Önceki işaretleyiciye atla' },
  'keys.act.toggleDisable': { en: 'Disable / enable selected clips', tr: 'Seçili klipleri kapat / aç' },
  'keys.act.newNote': { en: 'Work note at the playhead', tr: 'Oynatma çizgisinde iş notu' },
  'keys.act.splitHere': { en: 'Split target clip at playhead', tr: 'Hedef klibi oynatma çizgisinde böl' },
  'keys.act.trimLeft': { en: 'Delete the clip left of the playhead (its track closes up; Alt: every track)', tr: 'Klibin oynatma çizgisinin solundaki kısmını sil (yalnız kendi izi kayar; Alt: bütün izler)' },
  'keys.act.trimRight': { en: 'Delete the clip right of the playhead (its track closes up; Alt: every track)', tr: 'Klibin oynatma çizgisinin sağındaki kısmını sil (yalnız kendi izi kayar; Alt: bütün izler)' },
  'keys.act.closeGap': { en: 'Close gap at playhead', tr: 'Oynatma çizgisindeki boşluğu kapat' },
  'keys.act.shuttleBack': { en: 'Shuttle rewind (J)', tr: 'Geri sar (J)' },
  'keys.act.shuttlePause': { en: 'Shuttle pause (K)', tr: 'Sarmayı durdur (K)' },
  'keys.act.shuttleForward': { en: 'Shuttle forward (L)', tr: 'İleri sar (L)' },
  'keys.name.space': { en: 'Space', tr: 'Boşluk' },
  'keys.name.left': { en: 'Left', tr: 'Sol ok' },
  'keys.name.right': { en: 'Right', tr: 'Sağ ok' },
  'keys.name.up': { en: 'Up', tr: 'Yukarı ok' },
  'keys.name.down': { en: 'Down', tr: 'Aşağı ok' },

  // ---- G15: the top bar's switch is the agent's access; "Connect agent" is the
  // command box's button that starts a session (components/agent/AgentTop.tsx)
  'agent.switch': { en: 'Agent access', tr: 'Ajan erişimi' },

  // ---- G9: the app's own question box (ui/confirm.ts) -------------------------
  'ask.openOther.title': { en: 'Open another project?', tr: 'Başka bir proje açılsın mı?' },
  'ask.openOther.why': { en: 'The unsaved changes in this one will be lost.', tr: 'Bu projedeki kaydedilmemiş değişiklikler kaybolur.' },
  'ask.openOther.ok': { en: 'Open without saving', tr: 'Kaydetmeden aç' },
  'ask.newProject.title': { en: 'Start a new project?', tr: 'Yeni proje başlatılsın mı?' },
  'ask.newProject.why': { en: 'The unsaved changes in this one will be lost.', tr: 'Bu projedeki kaydedilmemiş değişiklikler kaybolur.' },
  'ask.newProject.ok': { en: 'Start without saving', tr: 'Kaydetmeden başlat' },
  'ask.trash.title': { en: 'Delete the project file?', tr: 'Proje dosyası silinsin mi?' },
  'ask.trash.ok': { en: 'Move to Recycle Bin', tr: 'Geri Dönüşüm Kutusu’na taşı' },
  'ask.cache.title': { en: 'Clear the cache?', tr: 'Önbellek temizlensin mi?' },
  'ask.deleteTrack.title': { en: 'Delete the track?', tr: 'Şerit silinsin mi?' },
  'ask.delete.ok': { en: 'Delete', tr: 'Sil' },

  // ---- G10: deleting a file from the media panel (components/MediaBin.tsx) ----
  'bin.item.deleteAsk.title': { en: 'Remove "{name}" from the project?', tr: '"{name}" projeden kaldırılsın mı?' },
  'bin.item.deleteAsk.subs.one': { en: 'So does the subtitle line heard in its sound.', tr: 'Sesinde duyulan altyazı satırı da gider.' },
  'bin.item.deleteAsk.subs.many': { en: 'So do the {n} subtitle lines heard in its sound.', tr: 'Sesinde duyulan {n} altyazı satırı da gider.' },
  'bin.item.deleteAsk.undo': { en: 'The file on the disk stays. Ctrl+Z brings it all back.', tr: 'Diskteki dosya kalır. Ctrl+Z hepsini geri getirir.' },
  'bin.item.deleteAsk.ok': { en: 'Remove', tr: 'Kaldır' }
} satisfies Record<string, Both>
