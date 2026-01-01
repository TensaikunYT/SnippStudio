// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words of phase 3c.T (the timeline's feel): the lane height step, "fit
// the film", the trim label. Each key in both languages (English is the
// default, Turkish is chosen in the settings); the type below asks for both
// and src/test/strings-his.test.ts checks it. Spread into STRINGS
// (ui/strings.ts). A file of its own, as strings-3c2.ts is: several sessions
// write at the same time.

/** One text of phase 3c.T: English and Turkish both. */
interface Both {
  en: string
  tr: string
}

export const STRINGS_HIS = {
  // ---- the lane height step (components/timeline/view-controls.tsx) -------------
  'timeline.height.small': { en: 'Small lanes: more of them in view (Alt + wheel changes the height)', tr: 'Küçük şeritler: daha çoğu görünür (Alt + tekerlek yüksekliği değiştirir)' },
  'timeline.height.medium': { en: 'Medium lanes (Alt + wheel changes the height)', tr: 'Orta şeritler (Alt + tekerlek yüksekliği değiştirir)' },
  'timeline.height.large': { en: 'Large lanes: taller thumbnails and sound (Alt + wheel changes the height)', tr: 'Büyük şeritler: daha yüksek küçük resimler ve ses (Alt + tekerlek yüksekliği değiştirir)' },
  'timeline.height.small.short': { en: 'S', tr: 'K' },
  'timeline.height.medium.short': { en: 'M', tr: 'O' },
  'timeline.height.large.short': { en: 'L', tr: 'B' },
  // ---- zoom ---------------------------------------------------------------------
  'timeline.zoom.fit': { en: 'Fit the whole film in the timeline', tr: 'Filmin tamamını çizelgeye sığdır' },
  // ---- a clip's trim label (components/timeline/clip-block.tsx) -----------------
  'clip.trim.tip.in': { en: 'In {time} · {sign}{delta} s · {length} s long', tr: 'Giriş {time} · {sign}{delta} sn · {length} sn uzun' },
  'clip.trim.tip.out': { en: 'Out {time} · {sign}{delta} s · {length} s long', tr: 'Çıkış {time} · {sign}{delta} sn · {length} sn uzun' },
  // ---- why a drop is refused (components/timeline/clip-block.tsx) ---------------
  'clip.drop.locked': { en: '{track} is locked', tr: '{track} kilitli' },
  'clip.drop.kind.video': { en: 'Drop on a video lane', tr: 'Bir video şeridine bırak' },
  'clip.drop.kind.audio': { en: 'Drop on a sound lane', tr: 'Bir ses şeridine bırak' },
  'clip.drop.strip.video': { en: 'Drop on a video lane or its + strip', tr: 'Bir video şeridine ya da + şeridine bırak' },
  'clip.drop.strip.audio': { en: 'Drop on a sound lane or its + strip', tr: 'Bir ses şeridine ya da + şeridine bırak' }
} satisfies Record<string, Both>
