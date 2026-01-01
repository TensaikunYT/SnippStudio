// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export check's findings in the interface's language (phase 9 audit
// patch D3): export/preflight.ts gives each finding its key and raw values;
// here the numbers and times are written as the language writes them
// ("2,0 sn", "0:06,0" in Turkish). English reads as the finding's own text.
import type { PreflightIssue } from './preflight'
import { t, type Params } from '../ui/strings'
import { fmtNum, fmtTime } from '../ui/format'
import { localizeMessage } from '../ui/errors'

export function preflightText(it: PreflightIssue): string {
  const say = it.say
  if (!say) return it.text
  const p: Params = {}
  if (say.s !== undefined) p.s = fmtNum(say.s, 1, true)
  if (say.from !== undefined) p.from = fmtTime(say.from, 1)
  if (say.to !== undefined) p.to = fmtTime(say.to, 1)
  if (say.n !== undefined) p.n = say.n
  if (say.name !== undefined) p.name = say.name
  if (say.why !== undefined) p.why = localizeMessage(say.why)
  return t(say.key, p)
}
