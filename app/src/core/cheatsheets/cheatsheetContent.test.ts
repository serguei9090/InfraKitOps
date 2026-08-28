import { describe, expect, it } from 'vitest'
import { CHEATSHEET_PAGES, EXTERNAL_RESOURCE_LINKS, RESOURCE_TYPES } from './cheatsheetContent'

describe('CHEATSHEET_PAGES structural integrity', () => {
  it('has at least one page', () => {
    expect(CHEATSHEET_PAGES.length).toBeGreaterThan(0)
  })

  it('includes the five expected pages by id', () => {
    const ids = new Set(CHEATSHEET_PAGES.map((p) => p.id))
    for (const expected of ['git', 'regex', 'sysctl', 'crontab', 'chmod']) {
      expect(ids.has(expected)).toBe(true)
    }
  })

  it('page ids are unique', () => {
    const ids = CHEATSHEET_PAGES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every page has a non-empty id, title, and description', () => {
    for (const page of CHEATSHEET_PAGES) {
      expect(page.id.trim().length).toBeGreaterThan(0)
      expect(page.title.trim().length).toBeGreaterThan(0)
      expect(page.description.trim().length).toBeGreaterThan(0)
    }
  })

  it('every page has at least one section', () => {
    for (const page of CHEATSHEET_PAGES) {
      expect(page.sections.length).toBeGreaterThan(0)
    }
  })

  it('every section has a non-empty title', () => {
    for (const page of CHEATSHEET_PAGES) {
      for (const section of page.sections) {
        expect(section.title.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('every section has at least one entry', () => {
    for (const page of CHEATSHEET_PAGES) {
      for (const section of page.sections) {
        expect(section.entries.length).toBeGreaterThan(0)
      }
    }
  })

  it('every entry has non-empty command, description, and example text', () => {
    for (const page of CHEATSHEET_PAGES) {
      for (const section of page.sections) {
        for (const entry of section.entries) {
          expect(entry.command.trim().length).toBeGreaterThan(0)
          expect(entry.description.trim().length).toBeGreaterThan(0)
          expect(entry.example.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('each page has a genuinely useful amount of content (at least 8 entries)', () => {
    for (const page of CHEATSHEET_PAGES) {
      const totalEntries = page.sections.reduce((sum, s) => sum + s.entries.length, 0)
      expect(totalEntries).toBeGreaterThanOrEqual(8)
    }
  })

  it('sysctl page cross-references the real keys used by the Linux sysctl tuner', () => {
    const sysctlPage = CHEATSHEET_PAGES.find((p) => p.id === 'sysctl')!
    const allCommands = new Set(sysctlPage.sections.flatMap((s) => s.entries).map((e) => e.command))

    // These are the exact sysctl keys lib/core/tuning/linux_sysctl_tuner.dart
    // writes into its generated config — the cheatsheet must document them
    // with the same spelling, not an invented variant.
    const tunerKeys = [
      'net.core.somaxconn',
      'net.ipv4.tcp_max_syn_backlog',
      'net.ipv4.tcp_tw_reuse',
      'net.core.default_qdisc',
      'net.ipv4.tcp_congestion_control',
      'net.core.rmem_max',
      'net.core.wmem_max',
      'net.ipv4.tcp_rmem',
      'net.ipv4.tcp_wmem',
    ]

    for (const key of tunerKeys) {
      expect(allCommands.has(key)).toBe(true)
    }
  })
})

describe('EXTERNAL_RESOURCE_LINKS structural integrity', () => {
  it('is not empty', () => {
    expect(EXTERNAL_RESOURCE_LINKS.length).toBeGreaterThan(0)
  })

  it('includes references for Zabbix, Ceph, PostgreSQL, Kubernetes, and the Linux Kernel', () => {
    const names = new Set(EXTERNAL_RESOURCE_LINKS.map((r) => r.name))
    for (const expected of ['Zabbix', 'Ceph', 'PostgreSQL', 'Kubernetes', 'Linux Kernel']) {
      expect(names.has(expected)).toBe(true)
    }
  })

  it('every link has a non-empty name, valid-looking https URL, and description', () => {
    for (const link of EXTERNAL_RESOURCE_LINKS) {
      expect(link.name.trim().length).toBeGreaterThan(0)
      expect(link.url.trim().length).toBeGreaterThan(0)
      expect(link.url.startsWith('https://')).toBe(true)
      expect(() => new URL(link.url)).not.toThrow()
      expect(link.description.trim().length).toBeGreaterThan(0)
    }
  })

  it('link names are unique', () => {
    const names = EXTERNAL_RESOURCE_LINKS.map((r) => r.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('has at least 34 entries (5 original docs links + 29 newly added resources)', () => {
    expect(EXTERNAL_RESOURCE_LINKS.length).toBeGreaterThanOrEqual(34)
  })

  it('the AI & Automation group has content (catalog + mcpServer seeded in phase D1)', () => {
    const byType = (t: string) => EXTERNAL_RESOURCE_LINKS.filter((l) => l.type === t)
    expect(byType('catalog').length).toBeGreaterThanOrEqual(10)
    expect(byType('mcpServer').length).toBeGreaterThanOrEqual(5)
    expect(EXTERNAL_RESOURCE_LINKS.some((l) => l.isDirectory === true)).toBe(true)
  })

  it('every entry has at least one non-empty tag', () => {
    for (const link of EXTERNAL_RESOURCE_LINKS) {
      expect(link.tags.length).toBeGreaterThan(0)
      for (const tag of link.tags) {
        expect(tag.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('at least one entry exists for every ResourceType listed in RESOURCE_TYPES', () => {
    const typesPresent = new Set(EXTERNAL_RESOURCE_LINKS.map((r) => r.type))
    for (const type of RESOURCE_TYPES) {
      expect(typesPresent.has(type)).toBe(true)
    }
  })

  it('every type used in the data is listed in RESOURCE_TYPES (groupByType ordering stays complete)', () => {
    const listed = new Set(RESOURCE_TYPES)
    for (const link of EXTERNAL_RESOURCE_LINKS) {
      expect(listed.has(link.type)).toBe(true)
    }
  })

  it('normalized URLs are unique (no dupes across trailing slash / case / tracking params)', () => {
    const normalize = (raw: string): string => {
      const u = new URL(raw)
      u.hash = ''
      for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid', 'via', 'ref']) {
        u.searchParams.delete(p)
      }
      let host = u.hostname.replace(/^www\./, '').toLowerCase()
      let path = u.pathname.replace(/\/+$/, '')
      if (host === 'github.com' || host === 'gitlab.com') path = path.toLowerCase()
      return `${host}${path}${u.search}`
    }
    const seen = new Map<string, string>()
    for (const link of EXTERNAL_RESOURCE_LINKS) {
      const key = normalize(link.url)
      expect(seen.has(key), `duplicate URL: ${link.url} vs ${seen.get(key)}`).toBe(false)
      seen.set(key, link.url)
    }
  })

  it('isDirectory, when set, is exactly true', () => {
    for (const link of EXTERNAL_RESOURCE_LINKS) {
      if ('isDirectory' in link && link.isDirectory !== undefined) {
        expect(link.isDirectory).toBe(true)
      }
    }
  })
})
