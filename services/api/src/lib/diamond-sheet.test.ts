import { describe, expect, it } from 'vitest'
import { parseCsv, phonesIn, rosterFromRows, rosterFromTabs, sheetRef } from './diamond-sheet'

describe('the IPC Diamond member sheet', () => {
  it('finds the spreadsheet and tab in a pasted link', () => {
    expect(sheetRef('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=42')).toEqual({
      id: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
      gid: '42',
    })
    expect(sheetRef('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit')?.gid).toBeNull()
    expect(sheetRef('https://example.com/sheet')).toBeNull()
  })

  it('reads quoted CSV cells', () => {
    expect(parseCsv('Name,Phone\r\n"Sharma, Asha",98765 43210\n"Say ""hi""",x')).toEqual([
      ['Name', 'Phone'],
      ['Sharma, Asha', '98765 43210'],
      ['Say "hi"', 'x'],
    ])
  })

  it('reads every number in a cell as its last ten digits', () => {
    expect(phonesIn('+91 98765-43210 / 091234 56780')).toEqual(['9876543210', '9123456780'])
    expect(phonesIn('12345')).toEqual([])
  })

  it('takes the phone column by its heading, with the name beside it', () => {
    const rows = [
      ['S.No', 'Member Name', 'City', 'Mobile Number'],
      ['1', 'Asha', 'Pune', '+91 98765 43210'],
      ['2', 'Ravi', 'Delhi', ''],
      ['3', 'Asha again', 'Pune', '9876543210'],
    ]
    expect(rosterFromRows(rows)).toEqual([{ phone: '9876543210', name: 'Asha' }])
  })

  it('finds the numbers without a heading, first row included', () => {
    const rows = [
      ['Asha', '9876543210'],
      ['Ravi', '9123456780'],
    ]
    expect(rosterFromRows(rows).map((r) => r.phone)).toEqual(['9876543210', '9123456780'])
  })

  it('gives nothing for a sheet with no numbers', () => {
    expect(rosterFromRows([['Name'], ['Asha']])).toEqual([])
    expect(rosterFromRows([])).toEqual([])
  })

  // Owner, 20 Oct: members on the list were told their number was not found.
  it('reads numbers however the sheet wrote them', () => {
    expect(phonesIn('98,765,43,210')).toEqual(['9876543210'])
    expect(phonesIn('9.87654321E+09')).toEqual(['9876543210'])
    expect(phonesIn('9876543210 9123456780')).toEqual(['9876543210', '9123456780'])
    expect(phonesIn('9876543210,9123456780')).toEqual(['9876543210', '9123456780'])
    expect(phonesIn('+919876543210 and 09123456780')).toEqual(['9876543210', '9123456780'])
    expect(phonesIn('9876543210 & 9123456780')).toEqual(['9876543210', '9123456780'])
  })

  it('reads every column that holds numbers, whatever its heading', () => {
    const rows = [
      ['Contact Name', 'Mob.', 'City', 'Alternate'],
      ['Asha', '98765 43210', 'Pune', ''],
      ['Ravi', '9123456780', 'Delhi', '9000012345'],
      ['Meena', '', 'Agra', '8000012345'],
    ]
    expect(rosterFromRows(rows)).toEqual([
      { phone: '9876543210', name: 'Asha' },
      { phone: '9123456780', name: 'Ravi' },
      { phone: '9000012345', name: 'Ravi' },
      { phone: '8000012345', name: 'Meena' },
    ])
  })

  it('does not take a number-looking ID or amount column', () => {
    const rows = [
      ['Name', 'Phone', 'Paid'],
      ['Asha', '9876543210', '25000'],
      ['Ravi', '9123456780', '25000'],
    ]
    expect(rosterFromRows(rows).map((r) => r.phone)).toEqual(['9876543210', '9123456780'])
  })

  it('reads every tab, each with its own heading', () => {
    const tabs = [
      [['Name', 'Phone'], ['Asha', '9876543210']],
      [['Mobile', 'Full name'], ['9123456780', 'Ravi'], ['9876543210', 'Asha again']],
    ]
    expect(rosterFromTabs(tabs)).toEqual([
      { phone: '9876543210', name: 'Asha' },
      { phone: '9123456780', name: 'Ravi' },
    ])
  })
})
