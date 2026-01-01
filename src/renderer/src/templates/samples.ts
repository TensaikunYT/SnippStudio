// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A new template block's sample items and its headline. Moved out of
// templates/model.ts in SnippStudio phase 2B (no change).
import { type TemplateItem, type TemplateKind } from '../types'

/** Placeholder words, so a fresh template reads as what it is. */
export function sampleItems(kind: TemplateKind): Omit<TemplateItem, 'id'>[] {
  switch (kind) {
    case 'steps':
      return [
        { title: 'Pick one problem', note: 'Small enough to finish today' },
        { title: 'Try the dumb fix first', note: 'Most of the time it works' },
        { title: 'Measure it', note: 'Numbers, not feelings' },
        { title: 'Keep what worked', note: 'Throw away the rest' }
      ]
    case 'ranking':
      return [
        { title: 'The winner', note: 'Why it is number one', value: 98 },
        { title: 'Runner-up', note: 'So close', value: 91 },
        { title: 'Third place', note: 'Solid pick', value: 84 },
        { title: 'Honourable mention', note: 'Worth a look', value: 77 },
        { title: 'Fifth', note: 'Made the list', value: 70 }
      ]
    case 'versus':
      return [
        { title: 'Option A' },
        { title: 'Option B' },
        { title: 'Speed', value: 8, value2: 6 },
        { title: 'Price', value: 5, value2: 9 },
        { title: 'Comfort', value: 7, value2: 7 }
      ]
    case 'stat':
      return [{ title: 'people watched this', value: 1250000, note: '' }, { title: 'in one week' }]
    case 'timeline':
      return [
        { title: 'It starts', note: '1969' },
        { title: 'The first big change', note: '1984' },
        { title: 'Everyone has one', note: '2007' },
        { title: 'Where we are now', note: '2026' }
      ]
    case 'count':
      return [{ title: 'It is free' }, { title: 'It runs offline' }, { title: 'It never slows down' }]
    case 'home':
      return [
        { title: 'The story', note: 'Part 1' },
        { title: 'The idea', note: 'Part 2' },
        { title: 'How it works', note: 'Part 3' },
        { title: 'What we learned', note: 'Part 4' }
      ]
    case 'map':
      return [{ title: 'Istanbul', note: 'Where it started' }, { title: 'Japan', note: 'Where it went next' }]
    case 'atlas':
      return [{ title: 'Istanbul', note: 'Where it started' }, { title: 'Egypt', note: 'Where it went next' }]
    case 'terminal':
      return [{ title: 'npm run build', note: 'Built in 1.2s' }, { title: 'git push', note: 'Everything up to date' }]
    case 'quote':
      return [{ title: 'Marcus Aurelius', note: 'Meditations, V.20' }]
    case 'compare':
      return [{ title: 'Before' }, { title: 'After' }]
    case 'boxes':
      return [{ title: 'Sleep', note: 'Where it starts' }, { title: 'Focus' }, { title: 'Mood' }, { title: 'Energy' }, { title: 'Memory' }]
    case 'domino':
      return [{ title: 'Drought' }, { title: 'Hunger' }, { title: 'Migration' }, { title: 'War' }]
    case 'checklist':
      return [{ title: 'Write the script' }, { title: 'Record the voice' }, { title: 'Cut the silences' }, { title: 'Add the music' }]
    case 'post':
      return [
        { title: 'This is the clearest explanation I have seen on the topic!', note: 'Ayşe', value: 1240 },
        { title: 'The examples make it so easy to follow', note: 'Mert', value: 386 }
      ]
    case 'poll':
      return [{ title: 'The first one', value: 62, note: '✓' }, { title: 'The second one', value: 25 }, { title: 'Neither', value: 13 }]
    case 'cards':
      return [{ title: 'Past' }, { title: 'Present' }, { title: 'Future' }]
    case 'store':
      return [
        { title: 'Sky Farmers', note: 'Simulation', value: 4.8 },
        { title: 'Pixel Knights', note: 'Adventure', value: 4.7 },
        { title: 'Ocean Drift', note: 'Racing', value: 4.6 },
        { title: 'Tiny Towns', note: 'Strategy', value: 4.6 },
        { title: 'Word Garden', note: 'Word', value: 4.5 },
        { title: 'Star Courier', note: 'Arcade', value: 4.5 },
        { title: 'Dungeon Bakery', note: 'Role playing', value: 4.4 },
        { title: 'Echo Run', note: 'Action', value: 4.4 },
        { title: 'Mosaic Mind', note: 'Puzzle', value: 4.3 },
        { title: 'Harbor Kings', note: 'Strategy', value: 4.3 },
        { title: 'Cloud Climb', note: 'Casual', value: 4.2 },
        { title: 'Neon Chef', note: 'Casual', value: 4.2 },
        { title: 'Lumen Quest', note: 'Adventure', value: 4.1 },
        { title: 'Rally Rush', note: 'Racing', value: 4.0 },
        { title: 'Paper Planes', note: 'Arcade', value: 3.9 }
      ]
    case 'player':
      return [
        { title: 'pause', value: 1.5 },
        { title: 'play', value: 3.3 },
        { title: 'quality', value: 5.2, note: '144p' },
        { title: 'cc', value: 6.6 }
      ]
    case 'words':
      return [{ title: 'Every great story' }, { title: 'starts with' }, { title: 'one small idea' }]
    case 'list':
      return [
        { title: 'Cappadocia', note: 'Balloons over the fairy chimneys at sunrise' },
        { title: 'Ephesus', note: 'The Library of Celsus, still standing' },
        { title: 'Pamukkale', note: 'White terraces of warm water' },
        { title: 'Mardin', note: 'A stone city over the plain' },
        { title: 'Istanbul', note: 'Two continents, one city' }
      ]
    case 'chapter':
      return [
        { title: 'The beginning', note: 'Where it all started' },
        { title: 'The turning point', note: 'Everything changes' },
        { title: 'What came after' },
        { title: 'Where we are now' }
      ]
    case 'news':
      return [
        { title: 'The year AI changed everything', note: 'The Daily Chronicle' },
        { title: 'Schools race to keep up with AI', note: 'Morning Herald' },
        { title: 'Is AI coming for your job?', note: 'Techline' },
        { title: 'AI panic grips the city', note: 'The Wire' },
        { title: 'Markets rally on AI hopes', note: 'Financial Ledger' },
        { title: 'Your phone now thinks with AI', note: 'Pocket News' },
        { title: 'AI: the promise and the peril', note: 'The Evening Gazette' },
        { title: 'Everyone is talking about AI', note: 'Weekly' }
      ]
    case 'chess':
      return [
        { title: 'e4' },
        { title: 'e5' },
        { title: 'Bc4' },
        { title: 'Nc6' },
        { title: 'Qh5', note: 'The queen comes out early' },
        { title: 'Nf6??', note: 'The mistake: f7 is left alone' },
        { title: 'Qxf7#', note: 'Checkmate in four moves' }
      ]
    case 'cutout':
      return [
        { title: 'The', value: 80 },
        { title: 'secret', value: 150 },
        { title: 'nobody', value: 100 },
        { title: 'tells', value: 90 },
        { title: 'you', value: 110 }
      ]
    case 'bars':
      return [
        { title: '2021', value: 12, note: 'K' },
        { title: '2022', value: 18 },
        { title: '2023', value: 31 },
        { title: '2024', value: 47 }
      ]
    case 'pie':
      return [
        { title: 'Videos', value: 45 },
        { title: 'Shorts', value: 30 },
        { title: 'Live', value: 15 },
        { title: 'Posts', value: 10 }
      ]
    case 'line':
      return [
        { title: 'Jan', value: 120, value2: 90 },
        { title: 'Feb', value: 180, value2: 110 },
        { title: 'Mar', value: 150, value2: 140 },
        { title: 'Apr', value: 260, value2: 150 },
        { title: 'May', value: 340, value2: 170 }
      ]
    case 'focus':
      return [
        { title: 'The first one', note: 'Add a photo to each card' },
        { title: 'The second one' },
        { title: 'The third one' }
      ]
    case 'gallery':
      return [
        { title: 'The first one', note: 'Add a photo to each item' },
        { title: 'The second one' },
        { title: 'The third one' },
        { title: 'The fourth one' },
        { title: 'The fifth one' },
        { title: 'The last one' }
      ]
  }
}

export function headline(kind: TemplateKind): string {
  switch (kind) {
    case 'steps':
      return 'How to do it'
    case 'ranking':
      return 'Top 5'
    case 'versus':
      return 'Which one wins?'
    case 'stat':
      return ''
    case 'timeline':
      return 'How we got here'
    case 'gallery':
      return 'Photos'
    case 'count':
      return 'Three reasons'
    case 'focus':
      return ''
    case 'home':
      return 'In this video'
    case 'map':
    case 'atlas':
      return ''
    case 'terminal':
      return '~/project'
    case 'quote':
      return 'The impediment to action advances action. What stands in the way becomes the way.'
    case 'cutout':
      return ''
    case 'compare':
      return ''
    case 'checklist':
      return 'Today'
    case 'domino':
      return ''
    case 'boxes':
      return ''
    case 'post':
      return ''
    case 'poll':
      return 'Which one would you pick?'
    case 'cards':
      return ''
    case 'chess':
      return "Scholar's Mate"
    case 'news':
      return 'AI'
    case 'chapter':
      return 'Chapter'
    case 'list':
      return '5 places worth the trip'
    case 'words':
      return ''
    case 'player':
      return ''
    case 'store':
      return 'Top Games'
    case 'bars':
      return 'Views per year'
    case 'pie':
      return 'Where the time goes'
    case 'line':
      return 'Subscribers'
  }
}
