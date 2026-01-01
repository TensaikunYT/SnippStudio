// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The 22 November repair round, worker A (SnippStudio D22-PLAN-A.md): what an
// agent's edit did, said in the user's words where the command's name used to
// be shown (the toast, the timeline's mark, the Steps list). English and
// Turkish, the same parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_D22_A = {
  'd22a.said.more': { en: '{first}, and {n} more', tr: '{first} ve {n} değişiklik daha' },
  'd22a.said.none': { en: 'a change that does not show on the timeline', tr: 'çizelgede görünmeyen bir değişiklik' },
  'd22a.step.nothing': { en: 'An edit of which nothing was applied', tr: 'Hiçbir şeyi uygulanmayan bir düzenleme' }
} as const
