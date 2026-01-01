// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// REF-AB, worker P2 (REF-AB-PLAN-P.md): the Projects window at launch, the
// media panel's badge, sort and search, the panels' search, favourites and
// recents, the empty states' pictures, the export window's name, place and
// cover. English and Turkish, the same parameters. Spread into STRINGS by
// ui/strings.ts.
export const STRINGS_REF_P = {
  // ---- item 1: the Projects window at launch -------------------------------------
  'refp.home.atLaunch': { en: 'Show Projects at launch', tr: 'Açılışta Projeler’i göster' },
  'refp.home.atLaunch.hint': { en: 'When the program starts with nothing to recover and no project handed to it, the Projects window opens first.', tr: 'Program kurtarılacak bir şey ve verilen bir proje olmadan açılınca önce Projeler penceresi gelir.' },
  'refp.home.first.title': { en: 'Start your first project', tr: 'İlk projeni başlat' },
  'refp.home.first.text': { en: 'Make a new project, open one from a file, or look around in the sample.', tr: 'Yeni bir proje yap, bir dosyadan aç ya da örnek projede dolaş.' },
  'refp.home.noMatch': { en: 'No project has that name.', tr: 'Bu adla proje yok.' },
  'refp.home.noMatch.action': { en: 'Clear the search', tr: 'Aramayı temizle' },

  // ---- item 5: the media panel ------------------------------------------------------
  'refp.bin.used': { en: 'In the timeline', tr: 'Çizelgede' },
  'refp.bin.used.hint': { en: 'This file has a clip in the timeline.', tr: 'Bu dosyanın çizelgede bir klibi var.' },
  'refp.bin.search': { en: 'Search media…', tr: 'Medyada ara…' },
  'refp.bin.search.label': { en: 'Search the media by name', tr: 'Medyayı ada göre ara' },
  'refp.bin.sort': { en: 'Sort', tr: 'Sırala' },
  'refp.bin.sort.added': { en: 'Order added', tr: 'Eklenme sırası' },
  'refp.bin.sort.name': { en: 'Name', tr: 'Ad' },
  'refp.bin.sort.date': { en: 'Date (newest first)', tr: 'Tarih (yeniden eskiye)' },
  'refp.bin.sort.duration': { en: 'Length (longest first)', tr: 'Süre (uzundan kısaya)' },
  'refp.bin.sort.kind': { en: 'Kind', tr: 'Tür' },
  'refp.bin.noMatch': { en: 'No file matches “{q}”.', tr: '“{q}” ile eşleşen dosya yok.' },

  // ---- item 6: search, favourites, recents ------------------------------------------
  'refp.pick.search': { en: 'Search…', tr: 'Ara…' },
  'refp.pick.search.label': { en: 'Search by name or group', tr: 'Ada ya da gruba göre ara' },
  'refp.pick.show': { en: 'Show', tr: 'Göster' },
  'refp.pick.all': { en: 'All', tr: 'Tümü' },
  'refp.pick.fav': { en: 'Favourites', tr: 'Favoriler' },
  'refp.pick.recent': { en: 'Recent', tr: 'Son' },
  'refp.pick.fav.hint': { en: 'The ones you marked with their bookmark', tr: 'Yer imiyle işaretlediklerin' },
  'refp.pick.recent.hint': { en: 'The last ones you used (at most 12)', tr: 'Son kullandıkların (en çok 12)' },
  'refp.pick.fav.add': { en: 'Add {name} to favourites', tr: '{name} favorilere eklensin' },
  'refp.pick.fav.remove': { en: 'Remove {name} from favourites', tr: '{name} favorilerden çıksın' },
  'refp.pick.noMatch': { en: 'Nothing matches “{q}”.', tr: '“{q}” ile eşleşen bir şey yok.' },
  'refp.pick.noFav': { en: 'No favourites yet. Mark one with its bookmark.', tr: 'Henüz favori yok. Birini yer imiyle işaretle.' },
  'refp.pick.noRecent': { en: 'Nothing used yet. What you use shows here.', tr: 'Henüz bir şey kullanılmadı. Kullandıkların burada görünür.' },
  'refp.pick.clear': { en: 'Clear the search', tr: 'Aramayı temizle' },
  'refp.pick.showAll': { en: 'Show all', tr: 'Tümünü göster' },
  'refp.fx.cinematize': { en: 'Cinematic motion', tr: 'Sinematik hareket' },
  'refp.pick.group.motion': { en: 'Motion', tr: 'Hareket' },
  'refp.pick.group.looks': { en: 'Looks', tr: 'Görünümler' },

  // ---- item 7: empty states ----------------------------------------------------------
  'refp.sound.empty': { en: 'Your sound library is empty. Add the sounds you use often.', tr: 'Ses kitaplığın boş. Sık kullandığın sesleri ekle.' },

  // ---- item 11: the export window's name, place and cover ----------------------------
  'refp.export.name': { en: 'Name', tr: 'Ad' },
  'refp.export.place': { en: 'Place', tr: 'Yer' },
  'refp.export.place.none': { en: 'Not chosen yet: asked once on Export', tr: 'Henüz seçilmedi: Dışa aktar’da bir kez sorulur' },
  'refp.export.place.choose': { en: 'Choose the folder', tr: 'Klasörü seç' },
  'refp.export.place.hint': { en: 'The last export folder.', tr: 'Son dışa aktarma klasörü.' },
  'refp.export.name.bad': { en: 'A file name cannot hold \\ / : * ? " < > | or end with a dot.', tr: 'Dosya adında \\ / : * ? " < > | olamaz ve ad noktayla bitemez.' },
  'refp.export.replace.title': { en: 'Replace the files?', tr: 'Dosyaların yerine yazılsın mı?' },
  'refp.export.replace.ask': { en: 'These files are already in the folder: {names}', tr: 'Bu dosyalar klasörde zaten var: {names}' },
  'refp.export.replace.ok': { en: 'Replace', tr: 'Yerine yaz' },
  'refp.export.refused': { en: 'The program cannot write there: {why}', tr: 'Program oraya yazamıyor: {why}' },
  'refp.export.cover': { en: 'Cover', tr: 'Kapak' },
  'refp.export.cover.write': { en: 'Also write the cover (PNG)', tr: 'Kapağı da yaz (PNG)' },
  'refp.export.cover.hint': { en: 'A still beside the video, for the thumbnail.', tr: 'Videonun yanında ayrı bir kare, küçük resim için.' },
  'refp.export.cover.change': { en: 'Change the cover', tr: 'Kapağı değiştir' },
  'refp.export.cover.playhead': { en: 'The frame at the playhead', tr: 'Oynatma çizgisindeki kare' },
  'refp.export.cover.at': { en: 'Moment', tr: 'An' },
  'refp.export.cover.time': { en: 'Cover at {time}', tr: 'Kapak {time} anında' },
  'refp.export.cover.drawing': { en: 'Drawing the frame…', tr: 'Kare çiziliyor…' },
  'refp.export.cover.suffix': { en: 'cover', tr: 'kapak' },
  'refp.export.cover.file': { en: 'Cover: {w} × {h} · PNG · at {time} s', tr: 'Kapak: {w} × {h} · PNG · {time} sn anında' }
} as const
