// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words of core polish, part B (tarifler\CILA.md "B": speed 0.1x – 100x
// and the pitch of a retimed clip's sound). Each key in both languages
// (English is the default, Turkish is chosen in the settings);
// src/test/strings-cila-b.test.ts checks it. Spread into STRINGS
// (ui/strings.ts). A file of its own, because other parts of the polish add
// their words at the same time.

/** One text: English and Turkish both. */
interface Both {
  en: string
  tr: string
}

export const STRINGS_CILA_B = {
  // ---- the speed row (components/inspector/clip-speed.tsx) ------------------------
  'insp.speed.times': { en: '{v}×', tr: '{v}×' },
  'insp.speed.oneFrame': { en: 'This clip is one frame long: it cannot play any faster.', tr: 'Bu klip bir kare uzunluğunda: daha hızlı oynatılamaz.' },
  'insp.speed.silent': {
    en: 'No sound at this speed: a clip slower than 0.25× or faster than 8× is silent, in the preview and in the export.',
    tr: 'Bu hızda ses yok: 0,25×’ten yavaş ya da 8×’ten hızlı klip, önizlemede de dışa aktarmada da sessizdir.'
  },
  'insp.speed.stepped': {
    en: 'Above 16× the preview skips frames while it plays; the export has every one.',
    tr: '16×’in üstünde önizleme oynarken kare atlar; dışa aktarmada her kare vardır.'
  },
  // ---- the sound of a retimed clip (components/inspector/clip-audio.tsx) -----------
  'insp.audio.keepPitch': { en: 'Keep pitch', tr: 'Perdeyi koru' },
  'insp.audio.keepPitch.hint': {
    en: 'On: a faster or slower clip keeps the pitch of its sound. Off: the pitch follows the speed, as on a tape. The preview and the export do the same.',
    tr: 'Açık: hızlandırılan ya da yavaşlatılan klibin ses perdesi aynı kalır. Kapalı: perde hızla birlikte kayar (bant gibi). Önizleme ve dışa aktarma aynısını yapar.'
  },
  'insp.audio.silentSpeed': {
    en: 'No sound at {v}×: a clip slower than 0.25× or faster than 8× is silent.',
    tr: '{v}× hızda ses yok: 0,25×’ten yavaş ya da 8×’ten hızlı klip sessizdir.'
  }
} satisfies Record<string, Both>
