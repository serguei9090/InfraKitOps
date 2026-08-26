import { describe, expect, it } from 'vitest'
import {
  ChmodCalculator,
  permissionsOctal,
  permissionsOctalFull,
  permissionsOctalPreferred,
  permissionsSymbolic,
  triadFromDigit,
  type ChmodPermissions,
} from './chmodCalculator'

describe('ChmodCalculator', () => {
  const calc = new ChmodCalculator()

  describe('octal -> symbolic -> octal round-trip', () => {
    for (const octal of ['644', '755', '600', '777']) {
      it(`${octal} round-trips through parse/symbolic/parse`, () => {
        const permissions = calc.parseOctal(octal)
        expect(permissionsOctal(permissions)).toBe(octal)

        const symbolic = permissionsSymbolic(permissions)
        const reparsed = calc.parseSymbolic(symbolic)
        expect(permissionsOctal(reparsed)).toBe(octal)
        expect(permissionsSymbolic(reparsed)).toBe(symbolic)
      })
    }

    it('644 renders as rw-r--r--', () => {
      expect(permissionsSymbolic(calc.parseOctal('644'))).toBe('rw-r--r--')
    })

    it('755 renders as rwxr-xr-x', () => {
      expect(permissionsSymbolic(calc.parseOctal('755'))).toBe('rwxr-xr-x')
    })

    it('600 renders as rw-------', () => {
      expect(permissionsSymbolic(calc.parseOctal('600'))).toBe('rw-------')
    })

    it('777 renders as rwxrwxrwx', () => {
      expect(permissionsSymbolic(calc.parseOctal('777'))).toBe('rwxrwxrwx')
    })
  })

  describe('structured <-> octal/symbolic round-trip', () => {
    it('building the structured permissions directly matches parse', () => {
      const permissions: ChmodPermissions = {
        owner: { read: true, write: true, execute: true },
        group: { read: true, write: false, execute: true },
        other: { read: true, write: false, execute: true },
        setUid: false,
        setGid: false,
        sticky: false,
      }

      expect(permissionsOctal(permissions)).toBe('755')
      expect(permissionsSymbolic(permissions)).toBe('rwxr-xr-x')
      expect(calc.parseOctal('755')).toEqual(permissions)
      expect(calc.parseSymbolic('rwxr-xr-x')).toEqual(permissions)
    })

    it('triadFromDigit round-trips through .digit', () => {
      for (let d = 0; d <= 7; d++) {
        const triad = triadFromDigit(d)
        const digit = (triad.read ? 4 : 0) | (triad.write ? 2 : 0) | (triad.execute ? 1 : 0)
        expect(digit).toBe(d)
      }
    })
  })

  describe('special bits', () => {
    it('4755 is setuid with lowercase s (owner execute is on)', () => {
      const permissions = calc.parseOctal('4755')
      expect(permissions.setUid).toBe(true)
      expect(permissions.setGid).toBe(false)
      expect(permissions.sticky).toBe(false)
      expect(permissionsOctalFull(permissions)).toBe('4755')
      expect(permissionsOctalPreferred(permissions)).toBe('4755')
      expect(permissionsSymbolic(permissions)).toBe('rwsr-xr-x')

      // Round-trips back through symbolic parsing.
      const reparsed = calc.parseSymbolic('rwsr-xr-x')
      expect(reparsed).toEqual(permissions)
      expect(permissionsOctalFull(reparsed)).toBe('4755')
    })

    it('2755 is setgid with lowercase s (group execute is on)', () => {
      const permissions = calc.parseOctal('2755')
      expect(permissions.setGid).toBe(true)
      expect(permissions.setUid).toBe(false)
      expect(permissions.sticky).toBe(false)
      expect(permissionsOctalFull(permissions)).toBe('2755')
      expect(permissionsSymbolic(permissions)).toBe('rwxr-sr-x')

      const reparsed = calc.parseSymbolic('rwxr-sr-x')
      expect(reparsed).toEqual(permissions)
      expect(permissionsOctalFull(reparsed)).toBe('2755')
    })

    it('1777 is sticky with lowercase t (other execute is on)', () => {
      const permissions = calc.parseOctal('1777')
      expect(permissions.sticky).toBe(true)
      expect(permissions.setUid).toBe(false)
      expect(permissions.setGid).toBe(false)
      expect(permissionsOctalFull(permissions)).toBe('1777')
      expect(permissionsSymbolic(permissions)).toBe('rwxrwxrwt')

      const reparsed = calc.parseSymbolic('rwxrwxrwt')
      expect(reparsed).toEqual(permissions)
      expect(permissionsOctalFull(reparsed)).toBe('1777')
    })

    it('uppercase S when setuid/setgid is set but execute bit is off', () => {
      // 4644: setuid on, but owner execute bit is off => uppercase S.
      const setuidNoExec = calc.parseOctal('4644')
      expect(setuidNoExec.setUid).toBe(true)
      expect(setuidNoExec.owner.execute).toBe(false)
      expect(permissionsSymbolic(setuidNoExec)).toBe('rwSr--r--')
      expect(calc.parseSymbolic('rwSr--r--')).toEqual(setuidNoExec)

      // 2644: setgid on, group execute bit off => uppercase S.
      const setgidNoExec = calc.parseOctal('2644')
      expect(setgidNoExec.setGid).toBe(true)
      expect(setgidNoExec.group.execute).toBe(false)
      expect(permissionsSymbolic(setgidNoExec)).toBe('rw-r-Sr--')
      expect(calc.parseSymbolic('rw-r-Sr--')).toEqual(setgidNoExec)
    })

    it('uppercase T when sticky is set but other execute bit is off', () => {
      // 1644: sticky on, other execute bit off => uppercase T.
      const stickyNoExec = calc.parseOctal('1644')
      expect(stickyNoExec.sticky).toBe(true)
      expect(stickyNoExec.other.execute).toBe(false)
      expect(permissionsSymbolic(stickyNoExec)).toBe('rw-r--r-T')
      expect(calc.parseSymbolic('rw-r--r-T')).toEqual(stickyNoExec)
    })

    it('octalPreferred omits the special digit when no special bit is set', () => {
      expect(permissionsOctalPreferred(calc.parseOctal('755'))).toBe('755')
      expect(permissionsOctalPreferred(calc.parseOctal('0755'))).toBe('755')
    })

    it('all three special bits combine (7777)', () => {
      const permissions = calc.parseOctal('7777')
      expect(permissions.setUid).toBe(true)
      expect(permissions.setGid).toBe(true)
      expect(permissions.sticky).toBe(true)
      expect(permissionsSymbolic(permissions)).toBe('rwsrwsrwt')
      expect(calc.parseSymbolic('rwsrwsrwt')).toEqual(permissions)
    })
  })

  describe('parse() notation auto-detection', () => {
    it('all-digit text is treated as octal', () => {
      expect(calc.parse('755')).toEqual(calc.parseOctal('755'))
    })

    it('non-digit text is treated as symbolic', () => {
      expect(calc.parse('rwxr-xr-x')).toEqual(calc.parseSymbolic('rwxr-xr-x'))
    })

    it('a leading file-type character is accepted (10-char symbolic)', () => {
      expect(calc.parse('-rwxr-xr-x')).toEqual(calc.parseSymbolic('rwxr-xr-x'))
      expect(calc.parse('drwxr-xr-x')).toEqual(calc.parseSymbolic('rwxr-xr-x'))
    })

    it('short octal is left-padded like chmod itself', () => {
      expect(permissionsOctal(calc.parseOctal('44'))).toBe('044')
      expect(calc.parseOctal('44')).toEqual(calc.parseOctal('044'))
    })
  })

  describe('invalid input is rejected cleanly', () => {
    it('empty mode', () => {
      expect(() => calc.parse('')).toThrow()
      expect(() => calc.parse('   ')).toThrow()
      expect(() => calc.parseOctal('')).toThrow()
    })

    it('octal digit above 7', () => {
      expect(() => calc.parseOctal('789')).toThrow()
      expect(() => calc.parse('789')).toThrow()
    })

    it('too many octal digits', () => {
      expect(() => calc.parseOctal('12345')).toThrow()
    })

    it('octal that is not a number', () => {
      expect(() => calc.parseOctal('abc')).toThrow()
    })

    it('symbolic mode of the wrong length', () => {
      expect(() => calc.parseSymbolic('rwxr-xr')).toThrow()
      expect(() => calc.parseSymbolic('rwxr-xr-xrwx')).toThrow()
    })

    it('symbolic mode with an invalid read character', () => {
      expect(() => calc.parseSymbolic('zwxr-xr-x')).toThrow()
    })

    it('symbolic mode with an invalid write character', () => {
      expect(() => calc.parseSymbolic('rzxr-xr-x')).toThrow()
    })

    it('symbolic mode with an invalid execute/special character', () => {
      expect(() => calc.parseSymbolic('rwzr-xr-x')).toThrow()
    })

    it('triadFromDigit rejects out-of-range digits', () => {
      expect(() => triadFromDigit(-1)).toThrow()
      expect(() => triadFromDigit(8)).toThrow()
    })
  })

  describe('describe', () => {
    it('plain 644 describes each class without special-bit sentences', () => {
      const description = calc.describe(calc.parseOctal('644'))
      expect(description).toContain('Owner can read and write')
      expect(description).toContain('Group can read')
      expect(description).toContain('Others can read')
      expect(description).not.toContain('setuid')
      expect(description).not.toContain('setgid')
      expect(description).not.toContain('sticky')
    })

    it('000 describes as no access for everyone', () => {
      const description = calc.describe(calc.parseOctal('000'))
      expect(description).toContain('Owner has no access')
      expect(description).toContain('Group has no access')
      expect(description).toContain('Others has no access')
    })

    it('4755 mentions setuid', () => {
      expect(calc.describe(calc.parseOctal('4755'))).toContain('setuid is set')
    })

    it('2755 mentions setgid', () => {
      expect(calc.describe(calc.parseOctal('2755'))).toContain('setgid is set')
    })

    it('1777 mentions the sticky bit', () => {
      expect(calc.describe(calc.parseOctal('1777'))).toContain('sticky bit is set')
    })
  })

  describe('execute (IToolUseCase) and fromPermissions', () => {
    it('produces the ready-to-paste command with the given path', () => {
      const result = calc.execute({ mode: '755', path: 'deploy.sh' })
      expect(result.command).toBe('chmod 755 deploy.sh')
      expect(result.octal).toBe('755')
      expect(result.octalFull).toBe('0755')
      expect(result.symbolic).toBe('rwxr-xr-x')
    })

    it('blank path falls back to "filename"', () => {
      const result = calc.execute({ mode: '644', path: '   ' })
      expect(result.command).toBe('chmod 644 filename')
    })

    it('the special-digit form is used in the command when set', () => {
      const result = calc.execute({ mode: '4755', path: 'suid-bin' })
      expect(result.command).toBe('chmod 4755 suid-bin')
    })

    it('fromPermissions matches execute for an equivalent structured input', () => {
      const permissions = calc.parseOctal('2755')
      const viaFromPermissions = calc.fromPermissions(permissions, 'x')
      const viaExecute = calc.execute({ mode: '2755', path: 'x' })
      expect(viaFromPermissions.command).toBe(viaExecute.command)
      expect(viaFromPermissions.symbolic).toBe(viaExecute.symbolic)
    })
  })
})
