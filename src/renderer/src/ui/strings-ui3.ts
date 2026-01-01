// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The new interface (v3, tarifler/UI-YENI.md): the words of the parts it
// added (the transport's end button, the timeline's clip actions). English
// and Turkish, the same parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_UI3 = {
  'transport.end': { en: 'Go to end', tr: 'Sona git' },
  'timeline.clipActions': { en: 'Selected clip', tr: 'Seçili klip' },
  'timeline.clipActions.speed': { en: 'Speed', tr: 'Hız' },
  'timeline.clipActions.speed.hint': { en: 'Play the selected clips faster or slower', tr: 'Seçili klipleri daha hızlı ya da yavaş oynat' },
  'timeline.clipActions.speed.item': { en: '{x}×', tr: '{x}×' },
  'timeline.clipActions.duplicate': { en: 'Duplicate', tr: 'Çoğalt' },
  'timeline.clipActions.duplicate.hint': { en: 'A copy of the selection right after it', tr: 'Seçimin bir kopyası, hemen ardına' },
  'timeline.clipActions.delete': { en: 'Delete', tr: 'Sil' },
  'timeline.clipActions.delete.hint': { en: 'Remove the selected clips (the gap stays)', tr: 'Seçili klipleri kaldır (boşluk kalır)' }
} as const
