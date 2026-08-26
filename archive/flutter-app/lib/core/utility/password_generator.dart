import 'dart:math';

import '../ports/i_tool_use_case.dart';

class PasswordGeneratorInput {
  const PasswordGeneratorInput({
    required this.length,
    this.includeUppercase = true,
    this.includeLowercase = true,
    this.includeDigits = true,
    this.includeSymbols = true,
  });

  final int length;
  final bool includeUppercase;
  final bool includeLowercase;
  final bool includeDigits;
  final bool includeSymbols;
}

class PasswordGeneratorResult {
  const PasswordGeneratorResult({required this.password});

  final String password;
}

/// Configurable random password generator.
///
/// Always draws from [Random.secure] -- this produces secrets, so the
/// platform CSPRNG is mandatory here, never the default pseudo-random
/// [Random()] constructor.
class PasswordGenerator
    implements IToolUseCase<PasswordGeneratorInput, PasswordGeneratorResult> {
  const PasswordGenerator();

  static const String uppercaseChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  static const String lowercaseChars = 'abcdefghijklmnopqrstuvwxyz';
  static const String digitChars = '0123456789';
  static const String symbolChars = r'!@#$%^&*()-_=+[]{}<>?/.,~';

  @override
  PasswordGeneratorResult execute(PasswordGeneratorInput input) {
    if (input.length <= 0) {
      throw ArgumentError('length must be positive');
    }
    if (!input.includeUppercase &&
        !input.includeLowercase &&
        !input.includeDigits &&
        !input.includeSymbols) {
      throw ArgumentError('at least one character set must be enabled');
    }

    final random = Random.secure();
    final selectedSets = <String>[
      if (input.includeUppercase) uppercaseChars,
      if (input.includeLowercase) lowercaseChars,
      if (input.includeDigits) digitChars,
      if (input.includeSymbols) symbolChars,
    ];
    final pool = selectedSets.join();

    // Guarantee at least one character from each selected set (when there's
    // room for it), then fill the remainder from the combined pool, then
    // shuffle so the guaranteed characters aren't always in the same spots.
    final chars = <String>[];
    for (final set in selectedSets) {
      if (chars.length >= input.length) break;
      chars.add(set[random.nextInt(set.length)]);
    }
    while (chars.length < input.length) {
      chars.add(pool[random.nextInt(pool.length)]);
    }
    chars.shuffle(random);

    return PasswordGeneratorResult(password: chars.join());
  }
}

class PassphraseGeneratorInput {
  const PassphraseGeneratorInput({
    this.wordCount = 4,
    this.separator = '-',
    this.capitalizeWords = false,
    this.includeNumber = false,
  });

  final int wordCount;
  final String separator;
  final bool capitalizeWords;
  final bool includeNumber;
}

class PassphraseGeneratorResult {
  const PassphraseGeneratorResult({required this.passphrase});

  final String passphrase;
}

/// Word-based passphrase generator (e.g. "correct-horse-battery-staple"),
/// drawing from [passphraseWordList].
///
/// Uses [Random.secure] for word selection -- same rationale as
/// [PasswordGenerator]: this is a secret generator, so it must use the
/// platform CSPRNG.
class PassphraseGenerator
    implements
        IToolUseCase<PassphraseGeneratorInput, PassphraseGeneratorResult> {
  const PassphraseGenerator();

  @override
  PassphraseGeneratorResult execute(PassphraseGeneratorInput input) {
    if (input.wordCount <= 0) {
      throw ArgumentError('wordCount must be positive');
    }

    final random = Random.secure();
    final words = List<String>.generate(input.wordCount, (_) {
      final word =
          passphraseWordList[random.nextInt(passphraseWordList.length)];
      return input.capitalizeWords ? _capitalize(word) : word;
    });

    if (input.includeNumber) {
      words.add(random.nextInt(100).toString());
    }

    return PassphraseGeneratorResult(passphrase: words.join(input.separator));
  }

  String _capitalize(String word) {
    if (word.isEmpty) return word;
    return word[0].toUpperCase() + word.substring(1);
  }
}

/// A reasonably sized static word list for passphrase generation.
///
/// This is not the full EFF long wordlist -- a few hundred common,
/// easy-to-type English words is enough for a "correct-horse-battery-staple"
/// style passphrase. 300 words gives ~8.2 bits of entropy per word.
const List<String> passphraseWordList = [
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
];
