// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The 22 November repair round, worker B (D22-PLAN-B.md): Q / W and the
// track-only close keeping linked pairs in step, the export window. English
// and Turkish, the same parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_D22_B = {
  // ---- a track-only close that could not keep a linked pair in step (K3) ----
  'd22b.close.gapLeft': {
    en: 'The gap was left open: a linked clip after it could not move up, because {track} is locked or has material there. Alt closes every track.',
    tr: 'Boşluk açık bırakıldı: sonraki bağlı bir klip öne gelemedi, çünkü {track} kilitli ya da orada malzeme var. Alt bütün izleri kapatır.'
  },
  // ---- Alt + ripple delete that could not keep a linked pair in step ----
  'd22b.delete.gapLeft': {
    en: 'Deleted, but the gap was left open: a linked clip after it could not move up, because {track} is locked or has material there.',
    tr: 'Silindi ama boşluk açık bırakıldı: sonraki bağlı bir klip öne gelemedi, çünkü {track} kilitli ya da orada malzeme var.'
  },
  // ---- a draft that switches a track's magnet (track.setMagnet) ----
  'd22b.change.magnetOff': {
    en: 'The magnet of {track} is switched off: its clips are no longer kept joined',
    tr: '{track} izinin mıknatısı kapatılır: klipleri artık bitişik tutulmaz'
  },
  'd22b.change.magnetOn': {
    en: 'The magnet of {track} is switched on: its clips are joined from the start, with no gaps',
    tr: '{track} izinin mıknatısı açılır: klipleri baştan başlayarak boşluksuz birleştirilir'
  }
} as const
