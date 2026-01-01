// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words of "cila" part D (tarifler\CILA.md "D"): LUTs and the built-in
// looks, the chroma keyer, the colour dials and the four new effects. Each key
// in both languages (English is the default, Turkish is chosen in the
// settings); src/test/strings-cila-d.test.ts checks it. Spread into STRINGS
// (ui/strings.ts). A file of its own because the other parts of the polish
// were adding their words at the same time.

/** One text: English and Turkish both. */
interface Both {
  en: string
  tr: string
}

export const STRINGS_CILA_D = {
  // ---- LUT (components/inspector/clip-look.tsx) -----------------------------
  'insp.lut.group.looks': { en: 'Looks', tr: 'Hazır görünümler' },
  'insp.lut.group.project': { en: 'This project’s LUT files', tr: 'Bu projenin LUT dosyaları' },
  'insp.lut.group.local': { en: 'On this computer only', tr: 'Yalnız bu bilgisayarda' },
  'insp.lut.amount': { en: 'LUT intensity', tr: 'LUT yoğunluğu' },
  'insp.lut.looks': { en: 'Looks', tr: 'Hazır görünümler' },
  'insp.lut.looks.hint': { en: 'Point at a look to see it on the picture, click to use it', tr: 'Resimde görmek için bir görünümün üstüne gel, kullanmak için tıkla' },
  'insp.lut.none': { en: 'None', tr: 'Yok' },
  'insp.lut.preset.warmFilm': { en: 'Warm film', tr: 'Sıcak film' },
  'insp.lut.preset.cool': { en: 'Cool', tr: 'Soğuk' },
  'insp.lut.preset.tealOrange': { en: 'Teal & orange', tr: 'Turkuaz-turuncu' },
  'insp.lut.preset.bleach': { en: 'Bleach', tr: 'Ağartma' },
  'insp.lut.preset.fadedMatte': { en: 'Faded matte', tr: 'Soluk mat' },
  'insp.lut.preset.monoContrast': { en: 'Bold B&W', tr: 'Kontrastlı siyah-beyaz' },
  'insp.lut.preset.oldFilm': { en: 'Old film', tr: 'Eski film' },
  'insp.lut.preset.night': { en: 'Night', tr: 'Gece' },
  'insp.lut.missingOption': { en: '{name} (missing)', tr: '{name} (eksik)' },
  'insp.lut.missing': {
    en: 'The LUT file “{name}” was not found: this clip is drawn without it, in the preview and in an export.',
    tr: '“{name}” LUT dosyası bulunamadı: bu klip önizlemede de dışa aktarmada da LUT’suz çizilir.'
  },
  'insp.lut.missingLocal': {
    en: 'The LUT “{name}” is not on this computer: this clip is drawn without it. Import its .cube file to bring it back.',
    tr: '“{name}” LUT’u bu bilgisayarda yok: bu klip LUT’suz çizilir. Geri getirmek için .cube dosyasını içe aktar.'
  },
  'insp.lut.localOnly': {
    en: 'This LUT is kept on this computer only. Import its .cube file once more and it travels with the project.',
    tr: 'Bu LUT yalnız bu bilgisayarda duruyor. .cube dosyasını bir kez daha içe aktarırsan projeyle birlikte taşınır.'
  },
  'insp.lut.find': { en: 'Find the file…', tr: 'Dosyayı bul…' },
  'insp.lut.retry': { en: 'Look again', tr: 'Yeniden bak' },

  // ---- colour dials -----------------------------------------------------------
  'insp.tone.exposure': { en: 'Exposure', tr: 'Pozlama' },
  'insp.tone.tint': { en: 'Tint', tr: 'Ton (yeşil–macenta)' },
  'insp.tone.highlights': { en: 'Highlights', tr: 'Işıklar' },
  'insp.tone.shadows': { en: 'Shadows', tr: 'Gölgeler' },

  // ---- the chroma keyer -------------------------------------------------------
  'insp.chroma.spill': { en: 'Spill removal', tr: 'Renk taşmasını bastır' },
  'insp.chroma.spill.hint': {
    en: 'Takes the key color’s cast off what stays (green on skin, on hair, on white)',
    tr: 'Kalan görüntüdeki anahtar rengin yansımasını alır (tende, saçta, beyazda yeşil)'
  },
  'insp.chroma.old': {
    en: 'This clip uses the first keyer, as the project was made with. The new one keys by color alone and removes spill.',
    tr: 'Bu klip, projenin yapıldığı ilk anahtarlayıcıyı kullanıyor. Yenisi yalnız renge bakar ve renk taşmasını bastırır.'
  },
  'insp.chroma.upgrade': { en: 'Use the new keyer', tr: 'Yeni anahtarlayıcıyı kullan' },
  'insp.chroma.picked': { en: 'Key color picked from the clip’s own picture', tr: 'Anahtar renk klibin kendi görüntüsünden alındı' },
  'insp.chroma.pickMiss': { en: 'That point is outside this clip’s picture', tr: 'O nokta bu klibin görüntüsünün dışında' },

  // ---- the four effects ---------------------------------------------------------
  'insp.fx.bloom': { en: 'Glow', tr: 'Parıltı' },
  'insp.fx.bloom.threshold': { en: 'Glow from', tr: 'Parıltı eşiği' },
  'insp.fx.bloom.radius': { en: 'Glow spread', tr: 'Parıltı genişliği' },
  'insp.fx.glowClassic': { en: 'Glow (classic)', tr: 'Parıltı (klasik)' },
  'insp.fx.halation': { en: 'Halation', tr: 'Işık halesi' },
  'insp.fx.halation.size': { en: 'Halation spread', tr: 'Hale genişliği' },
  'insp.fx.mosaic': { en: 'Mosaic', tr: 'Mozaik' },
  'insp.fx.isolate': { en: 'Color isolate', tr: 'Renk ayırma' },
  'insp.fx.isolate.hint': { en: 'Keeps one color and turns the rest black and white', tr: 'Tek rengi bırakır, gerisini siyah-beyaz yapar' },
  'insp.fx.isolate.color': { en: 'Color kept', tr: 'Kalan renk' },
  'insp.fx.isolate.range': { en: 'Color range', tr: 'Renk aralığı' },
  'insp.fx.isolate.amount': { en: 'Isolate amount', tr: 'Ayırma miktarı' },
  'insp.fx.key': { en: 'Keyframe this amount at the playhead (on a key: remove it)', tr: 'Bu miktara oynatma çizgisinde anahtar kare koy (anahtar karenin üstündeyken: kaldır)' },

  // ---- the file reading's repair (model/repair.ts) ----------------------------
  'project.repair.look': { en: '{n} look settings could not be read and were reset', tr: 'Okunamayan {n} görünüm ayarı sıfırlandı' }
} satisfies Record<string, Both>
