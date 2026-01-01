// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The spoken languages' names as the interface shows them (phase 9 audit
// patch D12). The Subtitles tab lists the 97 other languages Whisper knows by
// their Whisper names ("haitian creole"); in Turkish they are the browser's
// own names for them (Intl.DisplayNames, offline: ICU data in the program),
// found by their ISO codes. English keeps the Whisper name, capitalised.
import { getLang } from './strings'

/** Whisper's name → the ISO 639 code Intl knows (transformers.js
 *  common_whisper.js; its "jw" is "jv", its "myanmar" Burmese). */
const CODE: Record<string, string> = {
  english: 'en', chinese: 'zh', german: 'de', spanish: 'es', russian: 'ru', korean: 'ko', french: 'fr', japanese: 'ja',
  portuguese: 'pt', turkish: 'tr', polish: 'pl', catalan: 'ca', dutch: 'nl', arabic: 'ar', swedish: 'sv', italian: 'it',
  indonesian: 'id', hindi: 'hi', finnish: 'fi', vietnamese: 'vi', hebrew: 'he', ukrainian: 'uk', greek: 'el', malay: 'ms',
  czech: 'cs', romanian: 'ro', danish: 'da', hungarian: 'hu', tamil: 'ta', norwegian: 'no', thai: 'th', urdu: 'ur',
  croatian: 'hr', bulgarian: 'bg', lithuanian: 'lt', latin: 'la', maori: 'mi', malayalam: 'ml', welsh: 'cy', slovak: 'sk',
  telugu: 'te', persian: 'fa', latvian: 'lv', bengali: 'bn', serbian: 'sr', azerbaijani: 'az', slovenian: 'sl', kannada: 'kn',
  estonian: 'et', macedonian: 'mk', breton: 'br', basque: 'eu', icelandic: 'is', armenian: 'hy', nepali: 'ne', mongolian: 'mn',
  bosnian: 'bs', kazakh: 'kk', albanian: 'sq', swahili: 'sw', galician: 'gl', marathi: 'mr', punjabi: 'pa', sinhala: 'si',
  khmer: 'km', shona: 'sn', yoruba: 'yo', somali: 'so', afrikaans: 'af', occitan: 'oc', georgian: 'ka', belarusian: 'be',
  tajik: 'tg', sindhi: 'sd', gujarati: 'gu', amharic: 'am', yiddish: 'yi', lao: 'lo', uzbek: 'uz', faroese: 'fo',
  'haitian creole': 'ht', pashto: 'ps', turkmen: 'tk', nynorsk: 'nn', maltese: 'mt', sanskrit: 'sa', luxembourgish: 'lb',
  myanmar: 'my', tibetan: 'bo', tagalog: 'tl', malagasy: 'mg', assamese: 'as', tatar: 'tt', hawaiian: 'haw', lingala: 'ln',
  hausa: 'ha', bashkir: 'ba', javanese: 'jv', sundanese: 'su'
}

/** The ISO code of a Whisper language name (for the test: every one has one). */
export const languageCode = (name: string): string | undefined => CODE[name]

const cap = (s: string): string => s.charAt(0).toLocaleUpperCase(getLang() === 'tr' ? 'tr' : 'en') + s.slice(1)

let names: { lang: string; of: Intl.DisplayNames | null } | null = null

/** A spoken language's name: "Haitian creole" / "Haiti Kreyolu". */
export function spokenLanguageName(name: string): string {
  const lang = getLang()
  const english = cap(name)
  if (lang === 'en') return english
  if (!names || names.lang !== lang) {
    let of: Intl.DisplayNames | null = null
    try {
      of = new Intl.DisplayNames([lang], { type: 'language' })
    } catch {
      of = null
    }
    names = { lang, of }
  }
  const code = CODE[name]
  const said = code && names.of ? names.of.of(code) : undefined
  return said && said !== code ? cap(said) : english
}
