// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/i18n/terimler.mjs [--json] [--all]: term consistency of the
// interface's Turkish (SnippStudio phase 9b, decision 1). For every term of
// the glossary (SOZLUK.md, kept beside the repository, copied below as
// TERMS), every text whose English says the term must say the glossary's
// Turkish in its Turkish (its stem: Turkish adds endings and softens a last
// p, ç, t, k). A term with two meanings in English, or a text that uses the
// word in another sense, is listed in EXCEPT with its reason.
// Exit code 1 when a text breaks a term; --json prints the findings as JSON;
// --all lists every finding (else the first 5 per term).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const APP = fileURLToPath(new URL('../..', import.meta.url))
const UI = join(APP, 'src', 'renderer', 'src', 'ui')

/** [English word(s), Turkish stems, glossary note]. English: a regular
 *  expression's alternatives (word-bounded, any ending); Turkish: lower case. */
export const TERMS = [
  ['agent', ['ajan'], 'ajan'],
  ['animation', ['animasyon'], 'animasyon'],
  ['apply', ['uygula'], 'uygula'],
  ['approve', ['onay'], 'onayla'],
  ['archive', ['arşiv'], 'arşivle'],
  ['automation', ['otomasyon'], 'otomasyon'],
  ['background', ['arka plan'], 'arka plan'],
  ['cache', ['önbellek', 'önbelleğ'], 'önbellek'],
  ['canvas', ['tuval'], 'tuval'],
  ['caption|subtitle', ['altyazı'], 'altyazı'],
  ['clip', ['klip', 'klib'], 'klip'],
  ['code film', ['kod film'], 'kod filmi'],
  ['compound clip', ['bileşik'], 'bileşik klip'],
  ['draft', ['taslak', 'taslağ'], 'taslak'],
  ['drag', ['sürükle'], 'sürükle'],
  ['effect', ['efekt'], 'efekt'],
  ['export', ['dışa aktar'], 'dışa aktar'],
  ['filler', ['dolgu'], 'dolgu'],
  ['folder', ['klasör'], 'klasör'],
  ['import', ['içe aktar'], 'içe aktar'],
  ['keyframe', ['anahtar kare'], 'anahtar kare'],
  ['lane', ['şerit', 'şerid'], 'şerit'],
  ['layer', ['katman'], 'katman'],
  ['library', ['kitaplı', 'kitaplığ'], 'kitaplık'],
  ['loop', ['döngü'], 'döngü'],
  ['media', ['medya'], 'medya'],
  ['opacity', ['opaklı', 'opaklığ'], 'opaklık'],
  ['playhead', ['oynatma çizgi'], 'oynatma çizgisi'],
  ['proxy', ['vekil'], 'vekil'],
  ['queue', ['kuyruk', 'kuyruğ'], 'kuyruk'],
  ['ripple delete', ['kaydırarak sil'], 'kaydırarak sil'],
  ['shortcut', ['kısayol'], 'kısayol'],
  ['sound effect', ['ses efekt'], 'ses efekti'],
  ['template', ['şablon'], 'şablon'],
  ['timeline', ['çizelge'], 'çizelge'],
  ['toolbar', ['araç çubu'], 'araç çubuğu'],
  ['transcribe', ['yazıya dök'], 'yazıya dök'],
  ['transition', ['geçiş'], 'geçiş'],
  ['trim', ['kırp'], 'kırp'],
  ['undo', ['geri al'], 'geri al'],
  ['untitled', ['adsız'], 'adsız'],
  ['work note', ['iş not'], 'iş notu']
]

/** Turkish forms the glossary replaced: none may be left (one form per term). */
export const REPLACED = [
  ['oynatma kafa', 'oynatma çizgisi'],
  ['zaman çizelge', 'çizelge'],
  ['ana kare', 'anahtar kare'],
  ['efekt sesi', 'ses efekti']
]

/** Not checked, with the reason. Terms: a word whose English has several
 *  senses the glossary splits (cut, frame, open, note, track, save, select,
 *  window, mode, range, segment, render, review, reset, preview, remove,
 *  delete, split, snap, lock, marker, shape, file, project, colour, band,
 *  gradient, dock, append, reload, reopen, redo, stretch, transcript).
 *  Texts: key → the terms it uses in another sense. */
export const EXCEPT = {
  // The template "Timeline" is a history timeline (events along a line), not the editor's.
  'data.tpl.timeline': ['timeline'],
  // The map template's stages ("the timeline moves on"): its own line of years.
  'tpl.map.help.territory': ['timeline'],
  // Audio clipping (too loud): "kırpılma", not a clip.
  'transport.meter.hint': ['clip'],
  'insp.loud.peaks': ['clip'],
  'insp.afx.gate.help': ['clip'],
  // The export's render lanes (windows drawing at once): "kulvar", not a timeline lane.
  'renders.lanes.hint': ['lane'],
  'renders.lanes.one': ['lane'],
  'renders.lanes.many': ['lane'],
  // A photo's caption in a template (the words under a picture): "resim yazısı", not a subtitle.
  'tplf.photoCaption': ['caption'],
  // The Library of Celsus in Ephesus (a place), not the app's library.
  'tplf.site.ephesus': ['library']
}

function entries() {
  const files = readdirSync(UI).filter((f) => /^strings(-[a-z0-9-]+)?\.ts$/.test(f))
  const out = []
  for (const f of files) {
    const sf = ts.createSourceFile(f, readFileSync(join(UI, f), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const text = (e) => (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined)
    const visit = (n) => {
      if (ts.isPropertyAssignment(n) && ts.isStringLiteral(n.name) && ts.isObjectLiteralExpression(n.initializer)) {
        const props = new Map(n.initializer.properties.filter(ts.isPropertyAssignment).map((p) => [p.name.getText(sf), p.initializer]))
        if (props.has('en')) out.push({ file: f, key: n.name.text, en: text(props.get('en')) ?? '', tr: text(props.get('tr')) ?? '' })
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return out
}

/** The findings: per term, the texts whose Turkish lacks the glossary's word. */
export function check() {
  const all = entries()
  const found = []
  for (const [en, stems] of TERMS) {
    // Word-bounded, any English ending (clips, dragged, exporting); a
    // parameter's name ({clip}) is not a word.
    const re = new RegExp(`(?<![{\\w-])(?:${en})(?:s|es|d|ed|ing|ging|ped|ping)?(?![\\w}-])`, 'i')
    for (const e of all) {
      const english = e.en.replace(/\{\w+\}/g, '')
      if (!re.test(english)) continue
      if ((EXCEPT[e.key] ?? []).includes(en.split('|')[0])) continue
      const tr = e.tr.toLocaleLowerCase('tr')
      if (!stems.some((s) => tr.includes(s))) found.push({ term: en, key: e.key, file: e.file, en: e.en, tr: e.tr })
    }
  }
  for (const [old, now] of REPLACED)
    for (const e of all) if (e.tr.toLocaleLowerCase('tr').includes(old)) found.push({ term: `${old} → ${now}`, key: e.key, file: e.file, en: e.en, tr: e.tr })
  return { texts: all.length, terms: TERMS.length, found }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = check()
  if (process.argv.includes('--json')) console.log(JSON.stringify(r))
  else {
    const by = new Map()
    for (const f of r.found) by.set(f.term, [...(by.get(f.term) ?? []), f])
    console.log(`${r.texts} texts, ${r.terms} terms: ${r.found.length} texts break a term`)
    for (const [term, list] of by) {
      console.log(`\n${term} (${list.length})`)
      for (const f of process.argv.includes('--all') ? list : list.slice(0, 5)) console.log(`  ${f.key}: ${f.en}\n    ${f.tr}`)
    }
  }
  process.exitCode = r.found.length ? 1 : 0
}
