// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/**
 * Built-in word → emoji pack for caption decoration (300 entries).
 *
 * Keys are lower-case English words because the bundled Whisper model is the
 * English one; matching is done on the stripped word, so plurals like "guns"
 * won't hit "gun" — the common plural forms that matter are listed separately.
 */
export const EMOJI_PACK: Record<string, string> = {
  // ---- reactions & emotions -------------------------------------------------
  happy: '😄', sad: '😢', angry: '😡', mad: '😤', love: '❤️', hate: '💢',
  laugh: '😂', laughing: '🤣', funny: '😆', cry: '😭', crying: '😭', smile: '🙂',
  wow: '😮', omg: '😱', shocked: '😲', scared: '😨', scary: '👻', afraid: '😰',
  confused: '😕', tired: '🥱', sleepy: '😴', bored: '😐', sick: '🤢',
  cool: '😎', nice: '👌', perfect: '💯', amazing: '🤩', awesome: '🔥',
  crazy: '🤪', weird: '🤨', stupid: '🤦', dumb: '🤦', smart: '🧠', genius: '🧠',
  lucky: '🍀', unlucky: '💀', sorry: '🙏', please: '🙏', thanks: '🙏',
  yes: '✅', no: '❌', maybe: '🤷', okay: '👍', good: '👍', bad: '👎',
  best: '🏆', worst: '💩', win: '🏆', winner: '🏆', lose: '😩', loser: '😩',

  // ---- gaming ---------------------------------------------------------------
  game: '🎮', gaming: '🎮', gamer: '🎮', play: '▶️', player: '🎮',
  level: '🆙', levelup: '🆙', boss: '👹', enemy: '👾', enemies: '👾',
  kill: '💀', kills: '💀', killed: '☠️', death: '💀', dead: '💀', die: '💀',
  headshot: '🎯', shot: '🔫', shoot: '🔫', gun: '🔫', guns: '🔫', weapon: '⚔️',
  sword: '⚔️', shield: '🛡️', armor: '🛡️', arrow: '🏹', bow: '🏹',
  health: '❤️', heal: '💊', damage: '💥', hit: '💥', critical: '⚡',
  loot: '💎', treasure: '💎', chest: '🎁', reward: '🎁', prize: '🏅',
  coin: '🪙', coins: '🪙', gold: '🥇', silver: '🥈', bronze: '🥉',
  score: '📊', points: '🎯', combo: '🔥', streak: '🔥', rank: '📈',
  match: '⚔️', battle: '⚔️', fight: '🥊', versus: '⚔️', team: '🤝',
  squad: '👥', clutch: '😤', noob: '🐣', pro: '😎', skill: '✨',
  respawn: '♻️', spawn: '📍', map: '🗺️', quest: '📜', mission: '📜',
  speedrun: '⏱️', glitch: '🐛', bug: '🐛', lag: '🐌', ping: '📶',
  update: '⬆️', patch: '🔧', mod: '🧩', server: '🖥️', online: '🌐',

  // ---- money & work ---------------------------------------------------------
  money: '💰', cash: '💵', rich: '🤑', expensive: '💸', cheap: '🪙',
  buy: '🛒', sell: '🏷️', price: '🏷️', free: '🆓', deal: '🤝',
  work: '💼', job: '💼', business: '📈', boss2: '👔', office: '🏢',
  idea: '💡', plan: '🗓️', goal: '🎯', target: '🎯', focus: '🔍',
  time: '⏰', clock: '🕐', fast: '⚡', slow: '🐌', wait: '⏳',
  start: '🚀', begin: '🚀', finish: '🏁', end: '🏁', done: '✅',
  problem: '⚠️', warning: '⚠️', danger: '☠️', safe: '🔒', secret: '🤫',
  question: '❓', answer: '💬', truth: '🧐', lie: '🤥', proof: '🧾',

  // ---- tech -----------------------------------------------------------------
  computer: '💻', laptop: '💻', pc: '🖥️', phone: '📱', screen: '🖥️',
  keyboard: '⌨️', mouse: '🖱️', headset: '🎧', headphones: '🎧', mic: '🎤',
  camera: '📷', video: '🎥', record: '⏺️', stream: '📡', live: '🔴',
  internet: '🌐', wifi: '📶', download: '⬇️', upload: '⬆️', file: '📁',
  code: '💻', software: '💿', app: '📲', robot: '🤖', ai: '🤖',
  battery: '🔋', power: '⚡', charge: '🔌', signal: '📶', tech: '⚙️',

  // ---- nature & weather -----------------------------------------------------
  sun: '☀️', sunny: '☀️', moon: '🌙', night: '🌙', star: '⭐', stars: '✨',
  sky: '☁️', cloud: '☁️', rain: '🌧️', rainy: '🌧️', storm: '⛈️',
  snow: '❄️', cold: '🥶', ice: '🧊', hot: '🥵', fire: '🔥', flame: '🔥',
  water: '💧', ocean: '🌊', sea: '🌊', wave: '🌊', river: '🏞️',
  tree: '🌳', forest: '🌲', flower: '🌸', plant: '🌱', grass: '🌿',
  mountain: '⛰️', earth: '🌍', world: '🌍', space: '🚀', planet: '🪐',
  wind: '💨', thunder: '⚡', rainbow: '🌈', volcano: '🌋', desert: '🏜️',

  // ---- animals --------------------------------------------------------------
  dog: '🐶', cat: '🐱', bird: '🐦', fish: '🐟', horse: '🐴',
  lion: '🦁', tiger: '🐯', bear: '🐻', wolf: '🐺', fox: '🦊',
  monkey: '🐵', snake: '🐍', dragon: '🐉', shark: '🦈', whale: '🐋',
  eagle: '🦅', owl: '🦉', frog: '🐸', spider: '🕷️', bee: '🐝',
  cow: '🐮', pig: '🐷', sheep: '🐑', chicken: '🐔', rabbit: '🐰',
  mouse2: '🐭', elephant: '🐘', turtle: '🐢', penguin: '🐧', dinosaur: '🦖',

  // ---- food & drink ---------------------------------------------------------
  food: '🍽️', eat: '😋', hungry: '🤤', pizza: '🍕', burger: '🍔',
  fries: '🍟', bread: '🍞', cheese: '🧀', egg: '🥚', meat: '🍖',
  chicken2: '🍗', fish2: '🐠', rice: '🍚', pasta: '🍝', soup: '🍲',
  salad: '🥗', fruit: '🍎', apple: '🍎', banana: '🍌', orange: '🍊',
  grape: '🍇', strawberry: '🍓', watermelon: '🍉', lemon: '🍋', peach: '🍑',
  cake: '🍰', cookie: '🍪', chocolate: '🍫', candy: '🍬', icecream: '🍦',
  coffee: '☕', tea: '🍵', milk: '🥛', juice: '🧃', drink: '🥤',
  beer: '🍺', wine: '🍷', water2: '💧', honey: '🍯', salt: '🧂',

  // ---- sports & body --------------------------------------------------------
  sport: '🏅', football: '⚽', soccer: '⚽', basketball: '🏀', tennis: '🎾',
  baseball: '⚾', golf: '⛳', swim: '🏊', run: '🏃', running: '🏃',
  jump: '🦘', bike: '🚴', gym: '🏋️', strong: '💪', muscle: '💪',
  race: '🏁', medal: '🏅', trophy: '🏆', champion: '🏆', training: '🏋️',
  heart: '❤️', brain: '🧠', eye: '👁️', hand: '✋', foot: '🦶',

  // ---- travel & places ------------------------------------------------------
  car: '🚗', truck: '🚚', bus: '🚌', train: '🚆', plane: '✈️',
  boat: '⛵', ship: '🚢', rocket: '🚀', road: '🛣️', bridge: '🌉',
  home: '🏠', house: '🏠', school: '🏫', hospital: '🏥', hotel: '🏨',
  city: '🏙️', country: '🗺️', beach: '🏖️', park: '🏞️', castle: '🏰',
  travel: '🧳', trip: '🧳', vacation: '🏝️', ticket: '🎫', luggage: '🧳',

  // ---- objects & misc -------------------------------------------------------
  book: '📚', read: '📖', write: '✍️', pen: '🖊️', paper: '📄',
  key: '🔑', lock: '🔒', door: '🚪', box: '📦', bag: '🎒',
  gift: '🎁', party: '🎉', birthday: '🎂', music: '🎵', song: '🎶',
  dance: '💃', movie: '🎬', tv: '📺', art: '🎨', paint: '🎨',
  light: '💡', dark: '🌑', color: '🌈', magic: '🪄', ghost: '👻',
  alien: '👽', crown: '👑', diamond: '💎', ring: '💍', bomb: '💣',
  rocket2: '🚀', flag: '🚩', bell: '🔔', trash: '🗑️', clean: '🧼',
  medicine: '💊', doctor: '🧑‍⚕️', police: '👮', fireman: '🧑‍🚒', king: '🤴',
  baby: '👶', family: '👨‍👩‍👧', friend: '🫂', friends: '🫂', people: '👥',
  hello: '👋', bye: '👋', wave2: '👋', clap: '👏', point: '👉',
  up: '⬆️', down: '⬇️', left: '⬅️', right: '➡️', check: '✔️',
  new: '🆕', old: '👴', big: '🔝', small: '🔽', top: '🔝',
  first: '🥇', last: '🔚', next: '⏭️', back: '⏮️', repeat: '🔁',
  stop: '🛑', pause: '⏸️', loud: '🔊', quiet: '🔇', silence: '🤐',
  bright: '✨', shine: '✨', sparkle: '✨', boom: '💥', explosion: '💥',
  crash: '💥', broken: '💔', fix: '🔧', build: '🏗️', tool: '🛠️',
  search: '🔍', find: '🔎', look: '👀', watch: '👀', see: '👀',
  think: '🤔', know: '🧠', learn: '📚', teach: '🧑‍🏫', test: '📝',
  win2: '🎊', celebrate: '🎉', congrats: '🎊', welcome: '🤗', goodbye: '👋'
}

/** The pack serialised into the "word=emoji, word=emoji" rules format. */
export const DEFAULT_EMOJI_RULES = Object.entries(EMOJI_PACK)
  // Keys ending in a digit are disambiguators for a word already used above
  // (e.g. `boss2`) — strip the digit so the rule matches the real word only if
  // it isn't already taken.
  .filter(([k]) => !/\d$/.test(k))
  .map(([k, v]) => `${k}=${v}`)
  .join(', ')

/** How many words the pack actually maps. */
export const EMOJI_PACK_SIZE = Object.keys(EMOJI_PACK).filter((k) => !/\d$/.test(k)).length
