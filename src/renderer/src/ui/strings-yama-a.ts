// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The interface audit's patch, worker A (tarifler\YAMA-ARAYUZ.md): the words
// it added, English and Turkish, the same parameters
// (src/test/yama-ui-a.test.ts). Spread into STRINGS by ui/strings.ts.
export const STRINGS_YAMA_A = {
  // ---- E4: the remove tip under a selected clip (Delete removes the clip there)
  'ct.remove.hintClip': { en: 'Remove this transition', tr: 'Bu geçişi kaldır' },

  // ---- G8: a clip's entrance / exit and its movement while visible, by name
  'insp.anim.none': { en: 'None', tr: 'Yok' },
  'insp.anim.fade': { en: 'Fade', tr: 'Belirme' },
  'insp.anim.slideUp': { en: 'Slide up', tr: 'Yukarı kay' },
  'insp.anim.slideDown': { en: 'Slide down', tr: 'Aşağı kay' },
  'insp.anim.slideLeft': { en: 'Slide left', tr: 'Sola kay' },
  'insp.anim.slideRight': { en: 'Slide right', tr: 'Sağa kay' },
  'insp.anim.zoomIn': { en: 'Zoom in', tr: 'Yakınlaş' },
  'insp.anim.zoomOut': { en: 'Zoom out', tr: 'Uzaklaş' },
  'insp.anim.pop': { en: 'Pop', tr: 'Fırla' },
  'insp.anim.blur': { en: 'Blur', tr: 'Bulanık' },
  'insp.anim.spin': { en: 'Spin', tr: 'Dön' },
  'insp.anim.whip': { en: 'Whip', tr: 'Savrul' },
  'insp.anim.elastic': { en: 'Elastic', tr: 'Esnek' },
  'insp.anim.rampRight': { en: 'Speed ramp, right', tr: 'Hız rampası, sağa' },
  'insp.anim.rampLeft': { en: 'Speed ramp, left', tr: 'Hız rampası, sola' },
  'insp.anim.rampDown': { en: 'Speed ramp, down', tr: 'Hız rampası, aşağı' },
  'insp.anim.rampUp': { en: 'Speed ramp, up', tr: 'Hız rampası, yukarı' },
  'insp.idle.none': { en: 'None', tr: 'Yok' },
  'insp.idle.handheld': { en: 'Handheld', tr: 'Elde çekim' },
  'insp.idle.float': { en: 'Float', tr: 'Süzülme' },
  'insp.idle.sway': { en: 'Sway', tr: 'Salınım' },
  'insp.idle.breathe': { en: 'Breathe', tr: 'Nefes' }
} as const
