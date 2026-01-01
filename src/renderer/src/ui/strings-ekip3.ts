// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The team mode, step 3 (EKIP-3-PLAN.md): the workers' regions — the lines
// under the ruler, the list in the Agent tab, a claim that was refused and an
// op that dropped because of a region. English and Turkish, the same
// parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_EKIP3 = {
  'd22c.drop.region': { en: 'Another worker’s region: not applied. Only that worker writes there.', tr: 'Başka bir işçinin bölgesi: uygulanmadı. Oraya yalnız o işçi yazar.' },
  'ekip3.lines.label': { en: 'Workers’ regions', tr: 'İşçilerin bölgeleri' },
  'ekip3.region.tip': { en: '{name} · {range}', tr: '{name} · {range}' },
  'ekip3.region.tip.tracks': { en: '{name} · {range} · {tracks}', tr: '{name} · {range} · {tracks}' },
  'ekip3.regions.title': { en: 'Regions', tr: 'Bölgeler' },
  'ekip3.region.row': { en: '{range}', tr: '{range}' },
  'ekip3.region.row.tracks': { en: '{range} · {tracks}', tr: '{range} · {tracks}' },
  'ekip3.step.claimed': { en: 'Took a region', tr: 'Bölge aldı' },
  'ekip3.step.released': { en: 'Gave its region back', tr: 'Bölgesini bıraktı' },
  'ekip3.step.refused.what': { en: 'Region not taken', tr: 'Bölge alınamadı' },
  'ekip3.step.refused': { en: '{name} already has that stretch.', tr: 'O aralık {name} işçisinde.' },
  'ekip3.step.region': { en: 'Not applied: it would change {name}’s region.', tr: 'Uygulanmadı: {name} işçisinin bölgesini değiştiriyordu.' }
} as const
