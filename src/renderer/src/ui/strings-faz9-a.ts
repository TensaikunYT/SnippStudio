// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 9a's remaining words (worker I, FAZ9-PLAN.md): the Subtitles tab
// with one speech model (decision 7). English and Turkish, the same
// parameters (src/test/strings-all.test.ts). Spread into STRINGS by
// ui/strings.ts.
export const STRINGS_FAZ9_A = {
  // ---- the Subtitles tab: one model, the spoken language chosen
  'subs.lang.turkish': { en: 'Turkish', tr: 'Türkçe' },
  'subs.lang.english': { en: 'English', tr: 'İngilizce' },
  'subs.lang.hint': { en: 'The language spoken in the video. The model cannot tell it by itself: choose it for the right words and word timing.', tr: 'Videoda konuşulan dil. Model bunu kendisi anlayamaz: doğru kelimeler ve kelime zamanları için seç.' },
  'subs.model.note': { en: 'Runs offline, on the speech model that comes with {app} (Whisper Medium, multilingual).', tr: 'Çevrimdışı çalışır, {app} ile gelen konuşma modeliyle (Whisper Medium, çok dilli).' },
  'subs.model.missing': { en: 'The speech model is missing from this installation, so subtitles cannot be made. Reinstall {app} to put it back; everything else works.', tr: 'Konuşma modeli bu kurulumda yok, bu yüzden altyazı üretilemiyor. Geri getirmek için {app} uygulamasını yeniden kur; geri kalan her şey çalışır.' },

  // ---- the agent chooser: Antigravity, connected by hand (experimental)
  'agent.name.antigravity': { en: 'Antigravity', tr: 'Antigravity' },
} as const
