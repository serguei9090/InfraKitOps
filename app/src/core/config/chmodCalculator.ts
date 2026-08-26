import type { IToolUseCase } from '../ports/IToolUseCase'

/** The read/write/execute triad for one class of user (owner, group, other). */
export interface PermissionTriad {
  read: boolean
  write: boolean
  execute: boolean
}

function makeTriad(opts: Partial<PermissionTriad> = {}): PermissionTriad {
  return { read: false, write: false, execute: false, ...opts }
}

/** Builds a triad from a single octal digit (0-7). */
export function triadFromDigit(digit: number): PermissionTriad {
  if (digit < 0 || digit > 7) {
    throw new Error(`Octal digit ${digit} is out of range (allowed 0-7)`)
  }
  return makeTriad({ read: (digit & 4) !== 0, write: (digit & 2) !== 0, execute: (digit & 1) !== 0 })
}

function triadDigit(triad: PermissionTriad): number {
  return (triad.read ? 4 : 0) | (triad.write ? 2 : 0) | (triad.execute ? 1 : 0)
}

function triadEquals(a: PermissionTriad, b: PermissionTriad): boolean {
  return a.read === b.read && a.write === b.write && a.execute === b.execute
}

/**
 * The full Unix mode: three triads plus the three special bits.
 *
 * This is the canonical representation the calculator converts to and from;
 * octal text and symbolic text are both just renderings of it.
 */
export interface ChmodPermissions {
  owner: PermissionTriad
  group: PermissionTriad
  other: PermissionTriad
  /** setuid (octal 4000): run with the file owner's identity. */
  setUid: boolean
  /**
   * setgid (octal 2000): run with the file group's identity; on a directory,
   * new entries inherit that group.
   */
  setGid: boolean
  /** sticky / restricted-deletion bit (octal 1000). */
  sticky: boolean
}

function makePermissions(opts: Partial<ChmodPermissions> = {}): ChmodPermissions {
  return {
    owner: makeTriad(),
    group: makeTriad(),
    other: makeTriad(),
    setUid: false,
    setGid: false,
    sticky: false,
    ...opts,
  }
}

export function permissionsEquals(a: ChmodPermissions, b: ChmodPermissions): boolean {
  return (
    triadEquals(a.owner, b.owner) &&
    triadEquals(a.group, b.group) &&
    triadEquals(a.other, b.other) &&
    a.setUid === b.setUid &&
    a.setGid === b.setGid &&
    a.sticky === b.sticky
  )
}

function specialDigit(permissions: ChmodPermissions): number {
  return (permissions.setUid ? 4 : 0) | (permissions.setGid ? 2 : 0) | (permissions.sticky ? 1 : 0)
}

/** Three-digit octal, e.g. `755`. Special bits are not represented here. */
export function permissionsOctal(permissions: ChmodPermissions): string {
  return `${triadDigit(permissions.owner)}${triadDigit(permissions.group)}${triadDigit(permissions.other)}`
}

/** Four-digit octal including the special bits, e.g. `4755`. */
export function permissionsOctalFull(permissions: ChmodPermissions): string {
  return `${specialDigit(permissions)}${permissionsOctal(permissions)}`
}

/**
 * The shortest octal string that still round-trips: three digits when no
 * special bit is set, four otherwise.
 */
export function permissionsOctalPreferred(permissions: ChmodPermissions): string {
  return specialDigit(permissions) === 0 ? permissionsOctal(permissions) : permissionsOctalFull(permissions)
}

function triadSymbolic(triad: PermissionTriad, special: boolean, specialChar: string): string {
  const r = triad.read ? 'r' : '-'
  const w = triad.write ? 'w' : '-'
  let x: string
  if (special) {
    x = triad.execute ? specialChar : specialChar.toUpperCase()
  } else {
    x = triad.execute ? 'x' : '-'
  }
  return `${r}${w}${x}`
}

/**
 * Nine-character symbolic form, e.g. `rwxr-xr-x` or `rwsr-sr-t`.
 *
 * The special bits reuse the execute slot: lowercase `s`/`t` when the
 * execute bit is also set, uppercase `S`/`T` when it is not (which is how
 * `ls` signals the unusual "special bit without execute" combination).
 */
export function permissionsSymbolic(permissions: ChmodPermissions): string {
  return (
    triadSymbolic(permissions.owner, permissions.setUid, 's') +
    triadSymbolic(permissions.group, permissions.setGid, 's') +
    triadSymbolic(permissions.other, permissions.sticky, 't')
  )
}

/** Input for `ChmodCalculator`: a mode in either notation, plus the path the generated command should target. */
export interface ChmodInput {
  /**
   * Either octal (`755`, `4755`, `0644`) or symbolic (`rwxr-xr-x`,
   * `-rwxr-xr-x`). The notation is detected automatically.
   */
  mode: string
  path?: string
}

/** Everything the UI renders for one mode. */
export interface ChmodResult {
  permissions: ChmodPermissions
  /** Three-digit octal, e.g. `755`. */
  octal: string
  /** Four-digit octal, e.g. `0755` / `4755`. */
  octalFull: string
  /** Nine-character symbolic form, e.g. `rwxr-xr-x`. */
  symbolic: string
  /** The ready-to-paste command, e.g. `chmod 755 filename`. */
  command: string
  /** Plain-English summary of what the mode allows. */
  description: string
}

interface ParsedTriad {
  triad: PermissionTriad
  special: boolean
}

/**
 * Converts between octal, symbolic and structured Unix permissions, and
 * explains what a mode actually allows.
 *
 * Pure TypeScript — no packages, no I/O, no React.
 */
export class ChmodCalculator implements IToolUseCase<ChmodInput, ChmodResult> {
  execute(input: ChmodInput): ChmodResult {
    return this.fromPermissions(this.parse(input.mode), input.path ?? 'filename')
  }

  /** Builds a result from an already-structured mode. */
  fromPermissions(permissions: ChmodPermissions, path: string = 'filename'): ChmodResult {
    const target = path.trim().length === 0 ? 'filename' : path.trim()
    return {
      permissions,
      octal: permissionsOctal(permissions),
      octalFull: permissionsOctalFull(permissions),
      symbolic: permissionsSymbolic(permissions),
      command: `chmod ${permissionsOctalPreferred(permissions)} ${target}`,
      description: this.describe(permissions),
    }
  }

  /**
   * Parses either notation, choosing by shape: anything that is only digits
   * is octal, anything else is treated as symbolic.
   */
  parse(mode: string): ChmodPermissions {
    const text = mode.trim()
    if (text.length === 0) {
      throw new Error('Mode is empty — enter octal (e.g. 755) or symbolic (e.g. rwxr-xr-x)')
    }
    if (/^[0-9]+$/.test(text)) return this.parseOctal(text)
    return this.parseSymbolic(text)
  }

  /**
   * Parses 1-4 octal digits. Short forms are left-padded the way `chmod`
   * itself pads them (`44` means `044`).
   */
  parseOctal(mode: string): ChmodPermissions {
    const text = mode.trim()
    if (text.length === 0) {
      throw new Error('Octal mode is empty')
    }
    if (!/^[0-7]{1,4}$/.test(text)) {
      if (/^[0-9]+$/.test(text)) {
        if (text.length > 4) {
          throw new Error(`Octal mode "${text}" has ${text.length} digits (expected 1-4, e.g. 755 or 4755)`)
        }
        throw new Error(`Octal mode "${text}" contains a digit above 7 — octal digits are 0-7`)
      }
      throw new Error(`Octal mode "${text}" is not a number (expected 1-4 octal digits, e.g. 755)`)
    }

    const padded = text.padStart(4, '0')
    const special = parseInt(padded[0], 10)

    return makePermissions({
      owner: triadFromDigit(parseInt(padded[1], 10)),
      group: triadFromDigit(parseInt(padded[2], 10)),
      other: triadFromDigit(parseInt(padded[3], 10)),
      setUid: (special & 4) !== 0,
      setGid: (special & 2) !== 0,
      sticky: (special & 1) !== 0,
    })
  }

  /**
   * Parses a 9-character symbolic mode, optionally prefixed by the
   * file-type character `ls -l` prints (`-rwxr-xr-x`, `drwxr-xr-x`).
   */
  parseSymbolic(mode: string): ChmodPermissions {
    let text = mode.trim()
    if (text.length === 10) {
      // Drop the leading file-type character; it is not part of the mode.
      text = text.substring(1)
    }
    if (text.length !== 9) {
      throw new Error(
        `Symbolic mode "${mode.trim()}" must be 9 characters ` +
          '(e.g. rwxr-xr-x), or 10 with a leading file-type character',
      )
    }

    const owner = this.parseTriad(text.substring(0, 3), mode, 'owner', 's')
    const group = this.parseTriad(text.substring(3, 6), mode, 'group', 's')
    const other = this.parseTriad(text.substring(6, 9), mode, 'other', 't')

    return makePermissions({
      owner: owner.triad,
      group: group.triad,
      other: other.triad,
      setUid: owner.special,
      setGid: group.special,
      sticky: other.special,
    })
  }

  private parseTriad(text: string, fullMode: string, who: string, specialChar: string): ParsedTriad {
    const r = text[0]
    const w = text[1]
    const x = text[2]

    if (r !== 'r' && r !== '-') {
      throw new Error(`Invalid ${who} read character "${r}" in "${fullMode.trim()}" (expected "r" or "-")`)
    }
    if (w !== 'w' && w !== '-') {
      throw new Error(`Invalid ${who} write character "${w}" in "${fullMode.trim()}" (expected "w" or "-")`)
    }

    const upper = specialChar.toUpperCase()
    let execute: boolean
    let special: boolean
    if (x === 'x') {
      execute = true
      special = false
    } else if (x === '-') {
      execute = false
      special = false
    } else if (x === specialChar) {
      execute = true
      special = true
    } else if (x === upper) {
      execute = false
      special = true
    } else {
      throw new Error(
        `Invalid ${who} execute character "${x}" in "${fullMode.trim()}" ` +
          `(expected "x", "-", "${specialChar}" or "${upper}")`,
      )
    }

    return {
      triad: makeTriad({ read: r === 'r', write: w === 'w', execute }),
      special,
    }
  }

  /** Plain-English summary of what `permissions` allows. */
  describe(permissions: ChmodPermissions): string {
    const sentences: string[] = [
      `Owner ${this.triadPhrase(permissions.owner)}.`,
      `Group ${this.triadPhrase(permissions.group)}.`,
      `Others ${this.triadPhrase(permissions.other)}.`,
    ]

    if (permissions.setUid) {
      sentences.push(
        'setuid is set: the file runs with the permissions of its owner ' +
          `${permissions.owner.execute ? '' : '(but the owner execute bit is off, so it has no effect on execution) '}` +
          'rather than the user who started it.',
      )
    }
    if (permissions.setGid) {
      sentences.push(
        'setgid is set: the file runs with the permissions of its group' +
          `${permissions.group.execute ? '' : ' (but the group execute bit is off)'}; ` +
          'on a directory, new entries inherit that group.',
      )
    }
    if (permissions.sticky) {
      sentences.push(
        "The sticky bit is set: inside a directory, only a file's owner " +
          '(or root) can delete or rename it' +
          `${permissions.other.execute ? '' : ' (the other execute bit is off, so the directory is not traversable by others)'}.`,
      )
    }

    return sentences.join(' ')
  }

  private triadPhrase(triad: PermissionTriad): string {
    const verbs: string[] = []
    if (triad.read) verbs.push('read')
    if (triad.write) verbs.push('write')
    if (triad.execute) verbs.push('execute')
    if (verbs.length === 0) return 'has no access'
    if (verbs.length === 1) return `can ${verbs[0]}`
    return `can ${verbs.slice(0, -1).join(', ')} and ${verbs[verbs.length - 1]}`
  }
}
