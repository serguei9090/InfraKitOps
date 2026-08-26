import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Cryptographically secure random integer in `[0, max)`, via the Web Crypto
 * API's `getRandomValues` (available as a browser/webview global in both the
 * Vite web build and the Tauri webview -- never Node's `crypto` module).
 * Uses rejection sampling so the result is uniform, not modulo-biased.
 */
function secureRandomInt(max: number): number {
  if (max <= 0) throw new Error('max must be positive')
  const range = 0x100000000 // 2^32
  const limit = range - (range % max)
  const buffer = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]
  } while (value >= limit)
  return value % max
}

/** Fisher-Yates shuffle using the secure RNG above. Mutates `items` in place. */
function secureShuffle<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1)
    ;[items[i], items[j]] = [items[j], items[i]]
  }
}

export interface PasswordGeneratorInput {
  length: number
  includeUppercase?: boolean
  includeLowercase?: boolean
  includeDigits?: boolean
  includeSymbols?: boolean
}

export interface PasswordGeneratorResult {
  password: string
}

export const UPPERCASE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const LOWERCASE_CHARS = 'abcdefghijklmnopqrstuvwxyz'
export const DIGIT_CHARS = '0123456789'
export const SYMBOL_CHARS = '!@#$%^&*()-_=+[]{}<>?/.,~'

/**
 * Configurable random password generator.
 *
 * Always draws from the Web Crypto API's `getRandomValues` -- this produces
 * secrets, so the platform CSPRNG is mandatory here, never `Math.random`.
 * Mirrors Dart's `Random.secure()` requirement in
 * `lib/core/utility/password_generator.dart`.
 */
export class PasswordGenerator implements IToolUseCase<PasswordGeneratorInput, PasswordGeneratorResult> {
  execute(input: PasswordGeneratorInput): PasswordGeneratorResult {
    if (input.length <= 0) {
      throw new Error('length must be positive')
    }
    const includeUppercase = input.includeUppercase ?? true
    const includeLowercase = input.includeLowercase ?? true
    const includeDigits = input.includeDigits ?? true
    const includeSymbols = input.includeSymbols ?? true

    if (!includeUppercase && !includeLowercase && !includeDigits && !includeSymbols) {
      throw new Error('at least one character set must be enabled')
    }

    const selectedSets: string[] = []
    if (includeUppercase) selectedSets.push(UPPERCASE_CHARS)
    if (includeLowercase) selectedSets.push(LOWERCASE_CHARS)
    if (includeDigits) selectedSets.push(DIGIT_CHARS)
    if (includeSymbols) selectedSets.push(SYMBOL_CHARS)
    const pool = selectedSets.join('')

    // Guarantee at least one character from each selected set (when there's
    // room for it), then fill the remainder from the combined pool, then
    // shuffle so the guaranteed characters aren't always in the same spots.
    const chars: string[] = []
    for (const set of selectedSets) {
      if (chars.length >= input.length) break
      chars.push(set[secureRandomInt(set.length)])
    }
    while (chars.length < input.length) {
      chars.push(pool[secureRandomInt(pool.length)])
    }
    secureShuffle(chars)

    return { password: chars.join('') }
  }
}

export interface PassphraseGeneratorInput {
  wordCount?: number
  separator?: string
  capitalizeWords?: boolean
  includeNumber?: boolean
}

export interface PassphraseGeneratorResult {
  passphrase: string
}

/**
 * Word-based passphrase generator (e.g. "correct-horse-battery-staple"),
 * drawing from `passphraseWordList`.
 *
 * Uses the Web Crypto CSPRNG for word selection -- same rationale as
 * `PasswordGenerator`: this is a secret generator.
 */
export class PassphraseGenerator
  implements IToolUseCase<PassphraseGeneratorInput, PassphraseGeneratorResult>
{
  execute(input: PassphraseGeneratorInput): PassphraseGeneratorResult {
    const wordCount = input.wordCount ?? 4
    const separator = input.separator ?? '-'
    const capitalizeWords = input.capitalizeWords ?? false
    const includeNumber = input.includeNumber ?? false

    if (wordCount <= 0) {
      throw new Error('wordCount must be positive')
    }

    const words: string[] = []
    for (let i = 0; i < wordCount; i++) {
      const word = passphraseWordList[secureRandomInt(passphraseWordList.length)]
      words.push(capitalizeWords ? capitalize(word) : word)
    }

    if (includeNumber) {
      words.push(String(secureRandomInt(100)))
    }

    return { passphrase: words.join(separator) }
  }
}

function capitalize(word: string): string {
  if (word.length === 0) return word
  return word[0].toUpperCase() + word.slice(1)
}

/**
 * A reasonably sized static word list for passphrase generation.
 *
 * This is not the full EFF long wordlist -- a few hundred common,
 * easy-to-type English words is enough for a "correct-horse-battery-staple"
 * style passphrase. 300 words gives ~8.2 bits of entropy per word.
 */
export const passphraseWordList: string[] = [
  // Nature places
  'river', 'mountain', 'forest', 'ocean', 'desert',
  'valley', 'island', 'meadow', 'canyon', 'glacier',
  // Animals
  'tiger', 'lion', 'eagle', 'dolphin', 'panther',
  'falcon', 'wolf', 'bear', 'hawk', 'otter',
  // More animals
  'rabbit', 'turtle', 'beetle', 'sparrow', 'salmon',
  'badger', 'moose', 'lynx', 'heron', 'viper',
  // Colors
  'purple', 'orange', 'yellow', 'silver', 'golden',
  'crimson', 'violet', 'indigo', 'emerald', 'amber',
  // Instruments
  'guitar', 'violin', 'trumpet', 'piano', 'drum',
  'flute', 'harp', 'cello', 'banjo', 'clarinet',
  // Space
  'rocket', 'planet', 'comet', 'galaxy', 'meteor',
  'satellite', 'telescope', 'nebula', 'orbit', 'asteroid',
  // Buildings
  'castle', 'bridge', 'tower', 'garden', 'harbor',
  'village', 'cottage', 'cabin', 'palace', 'fortress',
  // Weather
  'thunder', 'lightning', 'breeze', 'storm', 'rainbow',
  'sunrise', 'sunset', 'twilight', 'horizon', 'whisper',
  // Fantasy
  'dragon', 'phoenix', 'griffin', 'unicorn', 'mermaid',
  'wizard', 'knight', 'giant', 'goblin', 'sorcerer',
  // Minerals
  'crystal', 'diamond', 'sapphire', 'topaz', 'quartz',
  'marble', 'granite', 'pebble', 'boulder', 'gravel',
  // Trees and plants
  'maple', 'willow', 'cedar', 'birch', 'pine',
  'oak', 'bamboo', 'fern', 'blossom', 'sprout',
  // Food
  'apple', 'banana', 'cherry', 'mango', 'lemon',
  'peach', 'grape', 'melon', 'coconut', 'papaya',
  // More food
  'pepper', 'garlic', 'onion', 'carrot', 'potato',
  'tomato', 'spinach', 'cabbage', 'pumpkin', 'radish',
  // Sweets and drinks
  'honey', 'sugar', 'syrup', 'cocoa', 'coffee',
  'cream', 'butter', 'cinnamon', 'vanilla', 'nectar',
  // Household
  'window', 'ladder', 'blanket', 'pillow', 'mirror',
  'curtain', 'carpet', 'lantern', 'candle', 'basket',
  // Tools
  'hammer', 'wrench', 'chisel', 'anchor', 'compass',
  'shovel', 'needle', 'thimble', 'bucket', 'ladle',
  // Clothes
  'jacket', 'sweater', 'scarf', 'mitten', 'sandal',
  'bonnet', 'apron', 'cloak', 'boot', 'glove',
  // Adjectives
  'happy', 'brave', 'gentle', 'clever', 'quiet',
  'swift', 'bold', 'calm', 'eager', 'fierce',
  // More adjectives
  'bright', 'shiny', 'cozy', 'sturdy', 'nimble',
  'quirky', 'jolly', 'sly', 'wise', 'proud',
  // Verbs
  'leap', 'glide', 'wander', 'drift', 'climb',
  'sail', 'race', 'soar', 'dash', 'roam',
  // More verbs
  'build', 'craft', 'forge', 'weave', 'carve',
  'paint', 'sketch', 'mold', 'shape', 'spark',
  // Abstract nouns
  'puzzle', 'riddle', 'secret', 'treasure', 'journey',
  'voyage', 'quest', 'legend', 'myth', 'saga',
  // Celestial
  'nova', 'aurora', 'zenith', 'cosmos', 'stardust',
  'eclipse', 'meridian', 'solstice', 'equinox', 'halo',
  // Sea life
  'whale', 'shark', 'octopus', 'coral', 'starfish',
  'seahorse', 'urchin', 'clam', 'oyster', 'marlin',
  // Insects and small creatures
  'butterfly', 'firefly', 'ladybug', 'cricket', 'dragonfly',
  'mantis', 'cicada', 'moth', 'wasp', 'ant',
  // Metals
  'bronze', 'copper', 'iron', 'steel', 'platinum',
  'titanium', 'cobalt', 'nickel', 'zinc', 'chrome',
  // Landscape features
  'cliff', 'plateau', 'lagoon', 'tundra', 'prairie',
  'marsh', 'dune', 'reef', 'grove', 'thicket',
  // Time and season
  'winter', 'summer', 'autumn', 'spring', 'morning',
  'evening', 'midnight', 'noon', 'dawn', 'dusk',
  // Abstract concepts
  'harmony', 'balance', 'courage', 'wisdom', 'freedom',
  'wonder', 'glory', 'destiny', 'fortune', 'triumph',
  // Misc objects
  'ember', 'beacon', 'torch', 'banner', 'shield',
  'arrow', 'kite', 'flame', 'blaze', 'glow',
]
