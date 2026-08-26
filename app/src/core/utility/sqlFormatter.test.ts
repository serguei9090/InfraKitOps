import { describe, expect, it } from 'vitest'
import { SqlFormatter } from './sqlFormatter'

describe('SqlFormatter', () => {
  const formatter = new SqlFormatter()

  it('pretty-prints major clauses onto their own uppercased line', () => {
    const result = formatter.execute({
      source: 'select id, name from users where age > 18 order by name',
      mode: 'pretty',
    })

    expect(result.isValid).toBe(true)
    expect(result.output).toBe('SELECT id, name\nFROM users\nWHERE age > 18\nORDER BY name')
  })

  it('indents AND/OR continuations and subqueries under parens', () => {
    const result = formatter.execute({
      source: 'select * from (select id from t) sub where a = 1 and b = 2',
      mode: 'pretty',
    })

    expect(result.isValid).toBe(true)
    expect(result.output).toContain('  SELECT id')
    expect(result.output).toContain('  AND b = 2')
  })

  it('minifies collapsing whitespace onto a single line', () => {
    const result = formatter.execute({
      source: 'select   id,\n  name\nfrom   users',
      mode: 'minify',
    })

    expect(result.isValid).toBe(true)
    expect(result.output).toBe('select id, name from users')
  })

  it('validate reports valid SQL', () => {
    const result = formatter.execute({ source: 'SELECT * FROM users', mode: 'validate' })

    expect(result.isValid).toBe(true)
  })

  it('rejects SQL with unbalanced parentheses', () => {
    const result = formatter.execute({
      source: 'SELECT * FROM users WHERE (id = 1',
      mode: 'validate',
    })

    expect(result.isValid).toBe(false)
    expect(result.errorMessage).not.toBeNull()
  })

  it('rejects empty input', () => {
    const result = formatter.execute({ source: '   ', mode: 'validate' })

    expect(result.isValid).toBe(false)
  })
})
