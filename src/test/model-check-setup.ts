// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Loaded before every test file (scripts/run-tests.mjs, NODE_OPTIONS
// --require): every edit a test makes, through a command or the store, is
// checked against the model's rules (model/check.ts, phase Ç2a.1). An edit
// that breaks one throws, so the test that made it fails. (Nothing is let
// through since phase Ç2b.1 fixed K-4 / P10, the last known fault.)
//   SNIPP_MODEL_CHECK=log SNIPP_MODEL_CHECK_LOG=<file>   lists them instead
import { appendFileSync } from 'node:fs'
import { loggingCheck, setModelCheck, throwingCheck } from '../renderer/src/model/check-hook'
import { setFreezeResults } from '../renderer/src/state/cow'

// The store's projects are kept by reference in the undo history (D1):
// what `produce` returns is frozen, so a write into one outside an edit throws.
setFreezeResults(true)

const mode = process.env.SNIPP_MODEL_CHECK ?? 'throw'
if (mode === 'throw') setModelCheck(throwingCheck())
else if (mode === 'log') {
  const file = process.env.SNIPP_MODEL_CHECK_LOG
  const test = process.argv.find((a) => a.endsWith('.test.js')) ?? process.argv[1]
  setModelCheck(
    loggingCheck((problems, what) => {
      if (file) appendFileSync(file, JSON.stringify({ test, what, problems, stack: new Error().stack?.split('\n').slice(3, 12).join('\n') }) + '\n')
    })
  )
}
