// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila K, "code values", the editor's side of serving: the hand-made changes
// of a code film's page (Asset.code.edits) reach its page by being written
// into its text as the main process serves it (main/codefilm-values.ts).
// The page's address names the list (`sne=<name>`): so a change of the list
// is another address, and the film module opens the page again for it (as
// for parameters), keeping the frames on screen meanwhile. Every load of the
// page (the preview's frame, a drawing window, the checker's fresh load, an
// export's reload) asks with the same name and so gets the same text:
// the preview and the export draw the same page.
import { editsKey } from '../../../shared/codeval/edits'
import type { CodeEdit } from '../../../shared/codeval/types'
import { api } from '../platform'
import type { Asset } from '../types'

const names = new WeakMap<readonly CodeEdit[], string>()
/** Per film: the name of the list the main process was last told. */
const told = new Map<string, string>()

/** The part of a film page's address for its hand-made changes ('' when it
 *  has none: such a film is opened exactly as before). Tells the main
 *  process the list under that name when it is not the one last told (the
 *  page's request waits for it there, so the order of the two is free). */
export function editsQuery(asset: Asset, filmId: string): string {
  const edits = asset.code?.edits
  if (!edits || !edits.length) return ''
  let name = names.get(edits)
  if (!name) names.set(edits, (name = editsKey(edits)))
  if (filmId && told.get(filmId) !== name && api?.codeFilm.valuesSet) {
    told.set(filmId, name)
    const said = name
    api.codeFilm.valuesSet(filmId, said, edits as unknown[]).catch(() => {
      // (Not told after all: the next ask tells it again.)
      if (told.get(filmId) === said) told.delete(filmId)
    })
  }
  return 'sne=' + name
}
