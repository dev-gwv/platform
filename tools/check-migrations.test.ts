import { describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain .mjs tool with no type declarations
import { checkMigrations, sqlOf } from './check-migrations.mjs'

type Result = { errors: string[]; warnings: string[] }
const check = (head: Record<string, string>, base: Record<string, string> | null): Result =>
  checkMigrations(new Map(Object.entries(head)), base ? new Map(Object.entries(base)) : null) as Result

const BASE = {
  '0001_a.sql': '-- a\ncreate table a (id int);\n',
  '0002_b.sql': '-- b\ncreate table b (id int);\n',
  '0003_claim.sql': '-- 0003: claimed, body to come\n',
}

describe('check-migrations', () => {
  it('strips comments and whitespace', () => {
    expect(sqlOf('-- x\n/* y */\n  select 1;  -- z\n')).toBe('select 1;')
    expect(sqlOf('-- only a header\n\n')).toBe('')
  })

  it('passes a new, higher migration and a comment-only edit', () => {
    const r = check({ ...BASE, '0001_a.sql': '-- a, now explained\ncreate table a (id int);', '0004_c.sql': 'select 1;' }, BASE)
    expect(r.errors).toEqual([])
  })

  it('fails two files with one number', () => {
    expect(check({ ...BASE, '0004_x.sql': 'select 1;', '0004_y.sql': 'select 2;' }, BASE).errors.join()).toMatch(/0004 is used by 2/)
  })

  it('fails a changed, renamed or deleted applied migration', () => {
    expect(check({ ...BASE, '0002_b.sql': 'create table b (id bigint);' }, BASE).errors.join()).toMatch(/0002_b.sql already exists/)
    const { '0002_b.sql': _gone, ...rest } = BASE
    expect(check({ ...rest, '0004_b.sql': BASE['0002_b.sql'] }, BASE).errors.join()).toMatch(/0002_b.sql exists on main and was renamed/)
  })

  it('lets a claim get its body, and only warns about a claim', () => {
    expect(check({ ...BASE, '0003_claim.sql': 'create table c (id int);' }, BASE).errors).toEqual([])
    const r = check(BASE, BASE)
    expect(r.errors).toEqual([])
    expect(r.warnings.join()).toMatch(/0003_claim.sql has no SQL yet/)
  })

  it('fails a new migration numbered at or below the base', () => {
    const base = { ...BASE, '0005_e.sql': 'select 5;' }
    expect(check({ ...base, '0004_late.sql': 'select 4;' }, base).errors.join()).toMatch(/0004_late.sql is new here but numbered 0004/)
  })

  it('without a base, still checks numbers', () => {
    expect(check({ ...BASE, '0001_dupe.sql': 'select 1;' }, null).errors.join()).toMatch(/0001 is used by 2/)
  })
})
