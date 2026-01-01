// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The code templates (phase 5f, decision 1): six working pages the user adds
// from the Templates panel. They live in the app (resources\kod-sablonlari\,
// packaged as extraResources), and one added is COPIED into
// `anim\<name>\` beside the saved project, a code clip's own folder like the
// code_clip tool's (its versions kept): the user's copy, never the original.
// No Electron here: tested in Node.
import { promises as fs } from 'node:fs'
import { ANIM_NAME, mustStayInside, OUTSIDE_PROJECT, realInside } from './codefilm-versions'
import { pathApi } from './platform-path'

/** The six, in the panel's order (each a folder with index.html). */
export const CODE_TEMPLATE_IDS = ['blank', 'lower-third', 'bar-chart', 'counter', 'arrow', 'title-card'] as const
export type CodeTemplateId = (typeof CODE_TEMPLATE_IDS)[number]

export function isCodeTemplateId(id: unknown): id is CodeTemplateId {
  return typeof id === 'string' && (CODE_TEMPLATE_IDS as readonly string[]).includes(id)
}

/** The first free `anim\<id>`, `anim\<id>-2`, … beside the project. */
async function freeFolder(animDir: string, id: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? id : `${id}-${n}`
    if (!ANIM_NAME.test(name)) break
    const folder = pathApi().join(animDir, name)
    const st = await fs.stat(folder).catch(() => null)
    if (!st) return folder
  }
  throw new Error('no free folder name')
}

/** Copies template `id` from `templatesDir` into a new `anim\<id>[-n]\`
 *  beside the saved project `projectPath`. Text files only, one level (a
 *  template is a page and nothing else); nothing is written over. */
export async function addCodeTemplate(templatesDir: string, projectPath: string, id: string): Promise<{ folder: string }> {
  if (!isCodeTemplateId(id)) throw new Error('unknown template')
  if (!pathApi().isAbsolute(projectPath) || !/\.snipp$/i.test(projectPath)) throw new Error('save the project first')
  const st = await fs.stat(projectPath).catch(() => null)
  if (!st?.isFile()) throw new Error('save the project first')
  const from = pathApi().join(templatesDir, id)
  const files = (await fs.readdir(from, { withFileTypes: true })).filter((e) => e.isFile() && /\.(html|js|css|json|txt)$/i.test(e.name))
  if (!files.some((f) => f.name.toLowerCase() === 'index.html')) throw new Error(`template ${id} has no index.html`)
  const projectDir = pathApi().dirname(projectPath)
  const animDir = pathApi().join(projectDir, 'anim')
  // (An `anim` that is a link out of the project folder gets no copy:
  // security patch, item 5; K-G3.)
  await mustStayInside(projectDir, animDir)
  await fs.mkdir(animDir, { recursive: true })
  const folder = await freeFolder(animDir, id)
  await fs.mkdir(folder)
  if (!(await realInside(projectDir, folder))) throw new Error(OUTSIDE_PROJECT)
  for (const f of files) await fs.copyFile(pathApi().join(from, f.name), pathApi().join(folder, f.name), 1 /* COPYFILE_EXCL */)
  return { folder }
}
