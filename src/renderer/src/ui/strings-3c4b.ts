// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.4b (the close of the interface's move): the words that were still
// written straight into the code (the notes' toasts), and the keyboard ways
// out added in this part. English and Turkish, the same parameters (one test
// for every strings file: src/test/strings-all.test.ts). Spread into STRINGS
// by ui/strings.ts.
export const STRINGS_3C4B = {
  // ---- the notes' toasts (notes/actions.ts, notes/review.ts) ----------------
  'notes.toast.empty': { en: 'Write what you want here, or draw on the frame.', tr: 'Ne istediğini buraya yaz ya da karenin üstüne çiz.' },
  'notes.toast.copyFailed': { en: 'Could not copy the message.', tr: 'İleti kopyalanamadı.' },
  'notes.toast.reviewDone': { en: 'Review done.', tr: 'İnceleme bitti.' },
} as const
