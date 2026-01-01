// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish T: the words of the transitions (the cut on the timeline, its
// menu, the Inspector, Ctrl+T, Library → Effects), the project's transition
// sounds, the timeline's tidied tools and the speed curve's mark on a clip.
// English and Turkish, the same parameters (src/test/strings-cila-t.test.ts).
// Spread into STRINGS by ui/strings.ts. The transitions' own names are the
// one set in strings-3c2.ts (`trans.opt.*`), plus the ramp's here.
export const STRINGS_CILA_T = {
  // ---- the kinds (the rest: trans.opt.*) -----------------------------------
  'ct.kind.ramp': { en: 'Ramp push', tr: 'Rampalı itme' },
  'ct.dir': { en: 'Direction', tr: 'Yön' },

  // ---- the cut on the timeline ---------------------------------------------
  'ct.target': { en: 'Add a transition: {name}, {s} s', tr: 'Geçiş ekle: {name}, {s} sn' },
  'ct.target.hint': { en: 'Add {name} ({s} s). Ctrl+T adds it at the cut nearest the playhead.', tr: '{name} ekle ({s} sn). Ctrl+T onu oynatma çizgisine en yakın kesime ekler.' },
  'ct.block.hint': { en: '{name}, {s} s. Click to edit it in the Inspector, drag an end to change its length, right-click for more.', tr: '{name}, {s} sn. Inspector’da düzenlemek için tıkla, süresi için bir ucunu sürükle, fazlası için sağ tıkla.' },
  'ct.menu': { en: 'Transition', tr: 'Geçiş' },
  'ct.menu.type': { en: 'Type', tr: 'Tür' },
  'ct.menu.default': { en: 'Make it the default', tr: 'Varsayılan yap' },
  'ct.menu.default.hint': { en: 'A click on a cut and Ctrl+T add this type and length', tr: 'Kesime tıklamak ve Ctrl+T bu türü ve süreyi ekler' },
  'ct.menu.delete': { en: 'Delete transition', tr: 'Geçişi sil' },
  'ct.tip': { en: '{s} s', tr: '{s} sn' },

  // ---- the Inspector -------------------------------------------------------
  'ct.between': { en: '{from} → {to}', tr: '{from} → {to}' },
  'ct.toEnd': { en: '{from} → black', tr: '{from} → siyah' },
  'ct.none': { en: 'No transition to the next clip.', tr: 'Sonraki klibe geçiş yok.' },
  'ct.add': { en: 'Add {name}', tr: '{name} ekle' },
  'ct.add.hint': { en: 'The default transition ({s} s). Pick another type below after adding it.', tr: 'Varsayılan geçiş ({s} sn). Ekledikten sonra aşağıdan başka bir tür seçebilirsin.' },
  'ct.grid': { en: 'Transition type', tr: 'Geçiş türü' },
  'ct.sound': { en: 'Its sound', tr: 'Sesi' },
  'ct.sound.project': { en: 'All transition sounds', tr: 'Bütün geçiş sesleri' },
  'ct.sound.project.hint': { en: 'Project → Sound: the level of every transition’s sound and the build-ups', tr: 'Proje → Ses: bütün geçişlerin ses düzeyi ve yükselişler' },
  'ct.play': { en: 'Play the cut', tr: 'Kesimi oynat' },
  'ct.play.hint': { en: 'From 1 s before the cut to 1 s after it', tr: 'Kesimin 1 sn öncesinden 1 sn sonrasına' },
  'ct.default': { en: 'Make default', tr: 'Varsayılan yap' },
  'ct.default.is': { en: 'Default for new transitions', tr: 'Yeni geçişlerin varsayılanı' },
  'ct.default.now': { en: 'New transitions: {name}, {s} s', tr: 'Yeni geçişler: {name}, {s} sn' },
  'ct.remove': { en: 'Remove', tr: 'Kaldır' },
  'ct.remove.hint': { en: 'Remove this transition (Delete)', tr: 'Bu geçişi kaldır (Delete)' },

  // ---- Ctrl+T, Library → Effects ------------------------------------------
  'ct.shortcut': { en: 'Add the default transition at the nearest cut', tr: 'En yakın kesime varsayılan geçişi ekle' },
  'ct.noCut': { en: 'No cut between two touching clips to put a transition on.', tr: 'Geçiş konacak, birbirine değen iki klip arasında kesim yok.' },
  'ct.dock.hint': { en: 'Drag a type onto a cut on the timeline, or click it to choose it for every cut below.', tr: 'Bir türü çizelgedeki bir kesime sürükle ya da aşağıdaki "her kesime" için seçmek üzere tıkla.' },
  'ct.dock.apply': { en: 'Put {name} on every cut', tr: 'Her kesime {name} koy' },
  'ct.dock.apply.hint': { en: 'Every cut where two clips touch, on the chosen track, in one undo step', tr: 'Seçili şeritte iki klibin birbirine değdiği her kesim, tek geri alma adımında' },

  // ---- the project's transition sounds (Project → Sound) -------------------
  'ct.projSound': { en: 'Transition sounds', tr: 'Geçiş sesleri' },
  'ct.projSound.hint': { en: 'Each transition has a quiet sound of its own. A single transition’s sound is in the Inspector when it is selected.', tr: 'Her geçişin kendine ait hafif bir sesi var. Tek bir geçişin sesi, seçiliyken Inspector’da.' },

  // ---- the timeline's tools ------------------------------------------------
  'ct.pack.on': { en: 'Close gaps automatically on {name}: on. Click to keep gaps.', tr: '{name} için boşlukları kendiliğinden kapat: açık. Boşlukları korumak için tıkla.' },
  'ct.pack.off': { en: 'Close gaps automatically on {name}: off. Click to close them as clips are removed.', tr: '{name} için boşlukları kendiliğinden kapat: kapalı. Klipler silindikçe kapatmak için tıkla.' },
  'ct.view': { en: 'View', tr: 'Görünüm' },
  'ct.view.label': { en: 'View: Shorts mode, trackers, guides, safe areas', tr: 'Görünüm: Shorts kipi, izleyiciler, kılavuzlar, güvenli alanlar' },
  'ct.view.hint': { en: 'How the preview is framed and what is drawn over it', tr: 'Önizlemenin kadrajı ve üstüne çizilenler' },
  'ct.lane.subtitles.hint': { en: 'Subtitles: the lines made from the voice, or imported', tr: 'Altyazılar: sesten üretilen ya da içe aktarılan satırlar' },

  // ---- the speed curve's mark on a clip ------------------------------------
  'ct.curve.badge': { en: '{min}–{max}×', tr: '{min}–{max}×' },
  'ct.curve.hint': { en: 'Speed curve: from {min}× to {max}×. The line under the clip is its speed along it.', tr: 'Hız eğrisi: {min}× ile {max}× arası. Klibin altındaki çizgi, boyunca hızıdır.' }
} as const
