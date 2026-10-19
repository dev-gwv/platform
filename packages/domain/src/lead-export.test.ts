import { describe, expect, it } from 'vitest'
import { crc32, defuse, dmy, istDateTime, leadExportCells, leadsCsv, leadsFileName, leadsXlsx, type LeadExportRow } from './lead-export'

const row: LeadExportRow = {
  created_at: '2026-10-18T06:30:00Z',
  name: '=HYPERLINK("x")',
  phone: '+919876543210',
  email: 'm@test.in',
  event_type: 'Wedding',
  event_date: '2027-02-14',
  city: 'Jaipur',
  venue: null,
  guests: 300,
  budget: 500000,
  said: 'Looking for: Photography\nTwo days',
  came_from: 'Partner QR',
  partner: 'Kiran Florist',
  stage: 'New',
  handled_by: 'Asha',
  follow_up_at: null,
}

describe('lead export', () => {
  it('writes dates in India time and the mobile as ten digits', () => {
    expect(istDateTime('2026-10-18T20:00:00Z')).toBe('19-10-2026 01:30')
    expect(dmy('2027-02-14')).toBe('14-02-2027')
    const cells = leadExportCells(row)
    expect(cells[0]).toBe('18-10-2026 12:00')
    expect(cells[2]).toBe('9876543210')
    expect(cells[9]).toBe(500000)
  })

  it('never lets text run as a formula', () => {
    expect(defuse('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(defuse('-5')).toBe("'-5")
    expect(defuse('Asha')).toBe('Asha')
    const csv = leadsCsv([row])
    expect(csv.startsWith('﻿Enquired on,Name,Mobile')).toBe(true)
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv.split('\r\n')).toHaveLength(3)
  })

  it('makes an xlsx zip with the sheet, a frozen header and filters', () => {
    const bytes = leadsXlsx([row])
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('<sheet name="Leads"')
    expect(text).toContain('state="frozen"')
    expect(text).toContain('<autoFilter ref="A1:P2"/>')
    expect(text).toContain('=HYPERLINK(&quot;x&quot;)') // a string cell, not a formula
    expect(text).not.toContain('<f>')
  })

  it('has a known crc and a plain file name', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(leadsFileName('Shubh Vivah Weddings', 'Kiran Florist', '2026-10-18', 'xlsx')).toBe(
      'shubh-vivah-weddings-leads-kiran-florist-2026-10-18.xlsx',
    )
    expect(leadsFileName('Asha', null, '2026-10-18', 'csv')).toBe('asha-leads-2026-10-18.csv')
  })
})
