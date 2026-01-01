// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A Text page card with its bookmark (REF-AB, item 6): the card, and at its
// corner a small bookmark that keeps it among the favourites. The bookmark is
// a button of its own beside the card's (a button cannot hold another).
import type { ReactNode } from 'react'
import { IconButton, useT } from '../../ui'
import { toggleFav, usePicks } from './picks'

export function Pick({ id, name, children }: { id: string; name: string; children: ReactNode }): JSX.Element {
  const t = useT()
  const on = usePicks().fav.includes(id)
  return (
    <div className={on ? 'text-pick is-fav' : 'text-pick'}>
      {children}
      <IconButton
        icon="bookmark"
        size="sm"
        className="text-pick-fav"
        label={t(on ? 'text.fav.remove' : 'text.fav.add', { name })}
        pressed={on}
        testid={`dock.text.fav.${id}`}
        onClick={() => toggleFav(id)}
      />
    </div>
  )
}
