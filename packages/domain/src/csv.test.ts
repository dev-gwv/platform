import { describe, expect, it } from 'vitest'
import { leadsFromCsv, mapLeadColumns, parseCsv } from './csv'

describe('parseCsv', () => {
  it('splits plain rows and drops blank lines', () => {
    expect(parseCsv('a,b\n1,2\n\n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('keeps commas, newlines and doubled quotes inside quoted cells', () => {
    const text = 'name,notes\n"Sharma, Priya","Wants ""candid"" style\nand an album"\n'
    expect(parseCsv(text)).toEqual([
      ['name', 'notes'],
      ['Sharma, Priya', 'Wants "candid" style\nand an album'],
    ])
  })

  it('handles CRLF and a UTF-8 BOM', () => {
    expect(parseCsv('﻿phone,name\r\n9876543210,Aanya\r\n')).toEqual([
      ['phone', 'name'],
      ['9876543210', 'Aanya'],
    ])
  })
})

describe('mapLeadColumns', () => {
  it('finds columns by their spreadsheet names, whatever the case or spacing', () => {
    expect(mapLeadColumns(['Full Name', 'Mobile Number', 'E-mail', 'Remarks'])).toEqual({
      name: 0,
      phone: 1,
      email: 2,
      notes: 3,
    })
  })

  it('is null when nothing looks like a phone column', () => {
    expect(mapLeadColumns(['Priya', '9876543210'])).toBeNull()
  })
})

describe('leadsFromCsv', () => {
  it('uses the header when there is one and points errors at the file line', () => {
    const { columns, records } = leadsFromCsv(parseCsv('Phone,Name\n9876543210,Aanya\n,Nobody\n'))
    expect(columns).toEqual(['Phone', 'Name'])
    // The extra columns a lead record now carries are absent from this file, so
    // every one of them must come back null rather than undefined -- the commit
    // contract distinguishes the two.
    const absent = {
      email: null,
      notes: null,
      source: null,
      city: null,
      event_type: null,
      event_date: null,
      event_location: null,
      deal_value: null,
      alternate_phone: null,
      quality: null,
    }
    expect(records).toEqual([
      { row: 2, name: 'Aanya', phone: '9876543210', ...absent },
      { row: 3, name: 'Nobody', phone: null, ...absent },
    ])
  })

  it('falls back to name, phone, email, notes positions without a header', () => {
    const { columns, records } = leadsFromCsv(parseCsv('Aanya,9876543210,a@x.in,Wedding\n'))
    expect(columns).toEqual(['name', 'phone', 'email', 'notes'])
    expect(records[0]).toMatchObject({ row: 1, name: 'Aanya', phone: '9876543210', email: 'a@x.in', notes: 'Wedding' })
  })
})
