// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 10 (macOS and Linux): the words it added, English and Turkish, the
// same parameters. Spread into STRINGS by ui/strings.ts. FAZ10-PLAN.md.
export const STRINGS_FAZ10 = {
  // ---- 10a.6: fonts this computer does not have -----------------------------
  'font.missing.option': { en: '{name} (not on this computer)', tr: '{name} (bu bilgisayarda yok)' },
  'pre.faz10.font': { en: 'The font “{name}” is not on this computer: the text is drawn in the system’s default face instead', tr: '“{name}” yazı tipi bu bilgisayarda yok: yazı onun yerine sistemin varsayılan yazı tipiyle çizilir' },
  // ---- 10b.1: an encoder this computer does not have -------------------------
  'export.codec.noAac': { en: 'This computer has no AAC sound encoder: a video is written as WebM (VP9 + Opus), sound only as MP3.', tr: 'Bu bilgisayarda AAC ses kodlayıcısı yok: video WebM (VP9 + Opus), yalnız ses MP3 olarak yazılır.' },
  'export.codec.noAvc': { en: 'This computer has no H.264 video encoder: the video is written as WebM (VP9 + Opus).', tr: 'Bu bilgisayarda H.264 görüntü kodlayıcısı yok: video WebM (VP9 + Opus) olarak yazılır.' },
  'export.codec.mp4Stop': { en: 'The video was not exported: this computer has no AAC sound encoder for an MP4. Choose WebM (VP9 + Opus).', tr: 'Video dışa aktarılmadı: bu bilgisayarda MP4 için AAC ses kodlayıcısı yok. WebM (VP9 + Opus) seç.' },
  'export.codec.m4aStop': { en: 'The sound was not exported: this computer has no AAC encoder for an M4A. Choose MP3 or WAV.', tr: 'Ses dışa aktarılmadı: bu bilgisayarda M4A için AAC kodlayıcısı yok. MP3 ya da WAV seç.' },
  // ---- 10b.7: the agent's manual connection outside Windows (an sh line) -----
  // ---- ready shortcut sets (added to phase 10 on 20 Nov 2026) ----------------
  'keys.preset.label': { en: 'Ready set', tr: 'Hazır takım' },
  'keys.preset.hint': { en: 'Sets every key at once. A set uses another editor’s documented keys where {app} has the same action; the rest stay as they are. You can still change any key, or reset to the defaults.', tr: 'Bütün tuşları birden ayarlar. Bir takım, {app} içinde aynı işi gören eylemler için öbür editörün belgelenmiş tuşlarını kullanır; gerisi olduğu gibi kalır. Her tuşu yine tek tek değiştirebilir ya da varsayılanlara dönebilirsin.' },
  'keys.preset.snippstudio': { en: '{app} (default)', tr: '{app} (varsayılan)' },
  'keys.preset.premiere': { en: 'Premiere Pro style', tr: 'Premiere Pro tarzı' },
  'keys.preset.davinci': { en: 'DaVinci Resolve style', tr: 'DaVinci Resolve tarzı' },
  'keys.preset.capcut': { en: 'CapCut style', tr: 'CapCut tarzı' },
  'keys.preset.custom': { en: 'Your own', tr: 'Kendi ayarın' },
  'keys.preset.unverified': { en: 'Not available yet: no public shortcut list from its maker could be checked.', tr: 'Henüz yok: üreticisinin herkese açık bir kısayol listesi doğrulanamadı.' },
  'keys.preset.capcutSame': { en: 'CapCut’s documented keys (split, in and out points) are the same as the defaults here.', tr: 'CapCut’ın belgelenmiş tuşları (bölme, giriş ve çıkış noktası) buradaki varsayılanlarla zaten aynı.' },
} as const
