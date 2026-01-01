// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/qa/ui-text-findings.cjs <file under src/renderer/src>…
// What src/test/ui-text.test.ts would say about these files (plain text and
// icon glyphs), whether or not they are on the exempt list. Needs the tests
// compiled (npm test once: out-test/). For moving a panel onto t() and Icon.
const { plainText, glyphs } = require('../../out-test/test/ui-text-scan.js')
let n = 0
for (const f of process.argv.slice(2)) {
  for (const x of [...plainText(f).map((y) => ({ ...y, kind: 'text' })), ...glyphs(f).map((y) => ({ ...y, kind: 'glyph' }))].sort((a, b) => a.line - b.line)) {
    console.log(`${x.file}:${x.line} [${x.kind}] ${x.what}`)
    n++
  }
}
console.log(`${n} findings`)
