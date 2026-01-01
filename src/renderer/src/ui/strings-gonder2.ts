// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// GONDER2-PLAN.md (23 Nov 2026): where a send stands and its Copy, the text
// Copy puts on the clipboard for the agent's chat, and the agent's phases as
// the top bar's chip and the agent bar say them. English and Turkish, the
// same parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_GONDER2 = {
  // ---- where a send stands (agent/send-line.ts) ----------------------------------
  'gonder2.agent': { en: 'The agent', tr: 'Ajan' },
  'gonder2.line.taken': { en: '{name} was waiting: it has it', tr: '{name} bekliyordu: aldı' },
  'gonder2.line.queued': { en: 'In line · paste it into the chat', tr: 'Sırada · sohbete yapıştır' },
  'gonder2.line.copied': { en: 'Copied · paste it into the chat', tr: 'Kopyalandı · sohbete yapıştır' },
  'gonder2.copy': { en: 'Copy', tr: 'Kopyala' },
  'gonder2.copyText': { en: 'Copy the text (for the agent’s chat)', tr: 'Metni kopyala (ajanın sohbeti için)' },
  'gonder2.copied': { en: 'Copied: paste it into your agent’s chat.', tr: 'Kopyalandı: ajanının sohbetine yapıştır.' },
  // ---- the text for the agent's chat (agent/paste.ts) ------------------------------
  'gonder2.paste.notes.one': { en: '1 work note from {app}:', tr: '{app} programından 1 iş notu:' },
  'gonder2.paste.notes.many': { en: '{n} work notes from {app}:', tr: '{app} programından {n} iş notu:' },
  'gonder2.paste.drawing': { en: 'drawn on the frame', tr: 'karede çizim var' },
  'gonder2.paste.task': { en: 'A job from {app}: "{text}"', tr: '{app} programından iş: "{text}"' },
  'gonder2.paste.selection': { en: 'Selected then: {what}', tr: 'O an seçili: {what}' },
  'gonder2.paste.where': { en: '(In the project "{name}" open in {app}.)', tr: '({app} programında açık "{name}" projesinde.)' },
  'gonder2.paste.untitled': { en: 'Untitled', tr: 'Adsız' },
  // ---- the agent's phase (the top bar's chip, the agent bar) ----------------------
  'gonder2.phase.working': { en: 'Working', tr: 'Çalışıyor' },
  'gonder2.phase.quiet': { en: 'Quiet', tr: 'Sessiz' },
  'gonder2.phase.waiting': { en: 'Waiting for you', tr: 'Seni bekliyor' },
  'gonder2.phase.reply': { en: 'Awaits your reply', tr: 'Cevabını bekliyor' },
  'gonder2.phase.draft': { en: 'Draft ready', tr: 'Taslak hazır' },
  'gonder2.phase.done': { en: 'Done', tr: 'Bitti' },
  'gonder2.phase.idle': { en: 'Connected', tr: 'Bağlı' },
  'gonder2.bar.quiet': { en: 'Quiet (may be thinking)', tr: 'Sessiz (düşünüyor olabilir)' },
  'gonder2.bar.reply': { en: 'Awaits your reply in the chat', tr: 'Sohbette cevabını bekliyor' },
  'gonder2.chip.reply': { en: '{name} is done and awaits your reply in its chat: what you send from here waits in line, so write in the chat (or Copy). Opens the Agent tab.', tr: '{name} bitirdi, sohbette cevabını bekliyor: buradan gönderdiğin sırada kalır; sohbete yaz (ya da Kopyala). Ajan sekmesini açar.' }
} as const
