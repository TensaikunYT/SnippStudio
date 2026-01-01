// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, worker D (D22-PLAN-D.md): interface details the audit found.
// English and Turkish, the same parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_D22_D = {
  // ---- Settings → General → Animations (L2, ui/motion.ts) ------------------------
  'd22d.motion': { en: 'Animations', tr: 'Animasyonlar' },
  'd22d.motion.hint': { en: 'The interface’s own motion: the agent’s pulse, the light at the preview’s edge, fades and slides. The small pictures of transitions and animations play when you point at them either way.', tr: 'Arayüzün kendi hareketi: ajanın nabzı, önizlemenin kenarındaki ışık, yumuşak geçişler ve kaymalar. Geçişlerin ve animasyonların küçük resimleri üstüne gelince her durumda oynar.' },
  'd22d.motion.system': { en: 'System', tr: 'Sistem' },
  'd22d.motion.system.off': { en: 'System (off now)', tr: 'Sistem (şu anda kapalı)' },
  'd22d.motion.on': { en: 'On', tr: 'Açık' },
  'd22d.motion.off': { en: 'Off', tr: 'Kapalı' },
  'd22d.motion.system.hint': { en: 'Follows your system’s setting for animation effects.', tr: 'Sisteminin animasyon efektleri ayarını izler.' },
  'd22d.motion.on.hint': { en: 'The interface moves, whatever the system’s setting says.', tr: 'Sistemin ayarı ne derse desin arayüz hareket eder.' },
  // ---- the preview toolbar's zoom number ----------------------------------------
  'd22d.preview.scale.hint': { en: 'How large the picture is shown. 100 % is its real size: one pixel of the project on one pixel of the screen (the 1:1 button).', tr: 'Resmin ne kadar büyük gösterildiği. %100 gerçek boyudur: projenin bir pikseli ekranın bir pikselinde (1:1 düğmesi).' },
  // ---- a value's keyframe diamond with the playhead on one of its keys (L12) ----
  'd22d.key.remove': { en: 'Remove this keyframe (the playhead is on it)', tr: 'Bu anahtar kareyi kaldır (oynatma çizgisi üstünde)' },
  // ---- the green screen's eyedropper put down because its clip was let go (L12) ----
  'd22d.dropper.away': { en: 'Eyedropper put down: its clip is no longer selected.', tr: 'Damlalık bırakıldı: klibi artık seçili değil.' },
  // ---- the left panel's Effects page: the moves as cards (L13) ---------------------
  'd22d.fx.hint': { en: 'Pick a move, set it below, then put it on your clips. Point at a card to see it play.', tr: 'Bir hareket seç, aşağıda ayarla, sonra kliplerine uygula. Oynadığını görmek için kartın üstüne gel.' },
  'd22d.motion.off.hint': { en: 'Nothing pulses, glows or slides; states are told by color and words.', tr: 'Hiçbir şey atmaz, parlamaz, kaymaz; durumlar renk ve yazıyla anlaşılır.' }
} as const
