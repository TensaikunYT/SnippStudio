// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Sending to the agent from the app (GONDER-PLAN.md, 21 Nov 2026): the words
// of the command box's free text, the notes' "Send to agent", the draft
// card's word for the agent and the Agent tab's waiting line and recent list.
// English and Turkish, the same parameters. Spread into STRINGS by ui/strings.ts.
export const STRINGS_GONDER = {
  // ---- the command box --------------------------------------------------------
  'agent.box.text': { en: 'Write a job for the agent or the app…', tr: 'Ajana ya da programa bir iş yaz…' },
  'agent.box.send': { en: 'Send', tr: 'Gönder' },
  'agent.box.sendHint': { en: 'Goes to the agent; a ready job’s words are done here', tr: 'Ajana gider; hazır bir işin sözü burada yapılır' },
  'agent.box.empty': { en: 'Write the job first.', tr: 'Önce işi yaz.' },
  'agent.box.off': { en: 'Agent access is off: the job was not sent. Connect an agent in Settings → Agent connection.', tr: 'Ajan erişimi kapalı: iş gönderilmedi. Ayarlar → Ajan bağlantısı’ndan bir ajan bağla.' },
  // ---- the Agent tab ------------------------------------------------------------
  'agent.wait.on': { en: 'The agent is waiting for you: it gets what you send at once', tr: 'Ajan seni bekliyor: gönderdiğin anda alır' },
  'agent.wait.off': { en: 'The agent is not waiting: what you send waits in line', tr: 'Ajan seni beklemiyor: gönderdiklerin sırada' },
  'agent.wait.queued': { en: '{n} in line', tr: '{n} iş sırada' },
  'agent.tool.wait': { en: 'Took what you sent', tr: 'Gönderdiğini aldı' },
  'agent.inbox.title': { en: 'Sent recently', tr: 'Son gönderilenler' },
  'agent.inbox.notes': { en: 'Notes: {nums}', tr: 'Notlar: {nums}' },
  'agent.inbox.task': { en: 'Job: {text}', tr: 'İş: {text}' },
  'agent.inbox.accepted': { en: 'Draft accepted', tr: 'Taslak kabul edildi' },
  'agent.inbox.partial': { en: 'Draft accepted in part', tr: 'Taslağın bir kısmı kabul edildi' },
  'agent.inbox.rejected': { en: 'Draft rejected', tr: 'Taslak reddedildi' },
  'agent.inbox.to': { en: 'to {client} · {time}', tr: '{client} · {time}' },
  // ---- the draft card -------------------------------------------------------------
  // ---- the notes ------------------------------------------------------------------
  'notes.send.queued': { en: 'In line for the agent ({n})', tr: 'Ajan için sırada ({n})' },
} as const
