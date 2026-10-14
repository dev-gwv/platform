import { describe, expect, it } from 'vitest'
import { parseCsv, phonesIn, rosterFromRows, sheetRef } from './diamond-sheet'

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
})
