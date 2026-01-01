// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Dalga 3, worker T (SnippStudio TOKEN-PLAN.md): the token card of the agent
// bar, "compared with raw", the job's progress (the agent's plan, the notes,
// similar jobs) and the finished jobs. English and Turkish, the same
// parameters. A text that depends on a count has ".one" and ".other"
// (agent/count.ts). Spread into STRINGS by ui/strings.ts.
export const STRINGS_TOKEN = {
  // ---- the card under the bar's "≈ N tokens" ----------------------------------
  'token.open': { en: 'What was counted', tr: 'Neler sayıldı' },
  'token.card.title': { en: 'Sent to the agent for this job', tr: 'Bu iş için ajana gönderilen' },
  'token.card.defs': { en: 'Tool definitions (once)', tr: 'Araç tanımları (bir kez)' },
  'token.card.text': { en: 'Answers: text', tr: 'Cevaplar: metin' },
  'token.card.images': { en: 'Answers: frames', tr: 'Cevaplar: kareler' },
  'token.card.total': { en: 'Total', tr: 'Toplam' },
  'token.card.raw': { en: 'Compared with raw', tr: 'Ham haline göre' },
  'token.card.rawSame': { en: 'no smaller', tr: 'küçülmedi' },
  'token.card.rawWas': { en: 'raw ≈ {n}', tr: 'ham ≈ {n}' },
  'token.card.note': { en: 'This is what {app} sent the agent; the agent’s own thinking and writing are not counted here.', tr: 'Bu, {app} tarafından ajana gönderilendir; ajanın kendi düşünmesi ve yazması burada sayılmaz.' },
  'token.n': { en: '≈ {n}', tr: '≈ {n}' },
  // "−62 %": the job's answers against the same answers raw.
  'token.saved': { en: '−{n}%', tr: '−%{n}' },
  'token.bar.saved': { en: '−{n}% vs raw', tr: 'ham haline göre −%{n}' },
  'token.bar.saved.hint': { en: 'The same answers sent raw (the project as JSON, every frame at full size) would have been this much bigger. Measured on this job.', tr: 'Aynı cevaplar ham gitseydi (proje JSON olarak, her kare tam boy) bu kadar büyük olurdu. Bu işte ölçüldü.' },
  // ---- progress: three honest sources, no countdown ---------------------------
  'token.plan': { en: 'step {step} / {of} · {name}', tr: 'adım {step} / {of} · {name}' },
  'token.plan.hint': { en: 'The agent’s own plan, as it wrote it.', tr: 'Ajanın kendi yazdığı plan.' },
  'token.plan.noted': { en: 'Wrote down its steps', tr: 'Adımlarını yazdı' },
  // ({done} comes with its Turkish ending: “2’si”, “3’ü”: agent/count.ts trOf.)
  'token.notes.one': { en: '{done} of {of} note done', tr: '{of} nottan {done} tamam' },
  'token.notes.other': { en: '{done} of {of} notes done', tr: '{of} nottan {done} tamam' },
  'token.notes.hint': { en: 'The notes you sent with this job that the agent marked ready.', tr: 'Bu işle gönderdiğin notlardan ajanın hazır dediği.' },
  'token.similar': { en: 'similar jobs took {d}', tr: 'benzer işler {d} sürdü' },
  'token.similar.hint': { en: 'The last jobs of the same kind by this agent. Not a countdown.', tr: 'Bu ajanın aynı türden son işleri. Geri sayım değil.' },
  'token.min': { en: '≈ {n} min', tr: '≈ {n} dk' },
  'token.underMin': { en: 'under a minute', tr: '1 dk’dan az' },
  // ---- finished jobs (the Agent tab) -------------------------------------------
  'token.jobs.title': { en: 'Finished jobs', tr: 'Biten işler' },
  'token.jobs.none': { en: 'None yet.', tr: 'Henüz yok.' },
  'token.jobs.changes.one': { en: '{n} change', tr: '{n} değişiklik' },
  'token.jobs.changes.other': { en: '{n} changes', tr: '{n} değişiklik' },
  'token.kind.notes': { en: 'Notes', tr: 'Notlar' },
  'token.kind.task': { en: 'Task', tr: 'Görev' },
  'token.kind.draft': { en: 'Draft answer', tr: 'Taslak cevabı' },
  'token.kind.handover': { en: 'Handed over', tr: 'Devralma' },
  'token.kind.free': { en: 'On its own', tr: 'Kendiliğinden' }
} as const
