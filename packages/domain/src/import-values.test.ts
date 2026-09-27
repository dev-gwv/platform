import { describe, expect, it } from 'vitest'
import { parseImportDate, parseImportMoney, parseImportQuality } from './csv'

/**
 * A shoot date read month-first is a shoot date wrong by up to eleven months,
 * and nothing anywhere reports it. These exist because the import now carries
 * event_date, deal_value and quality — seven columns the API has accepted since
 * 0107 while the importer quietly dropped them.
 */
describe('parseImportDate', () => {
  it('reads a numeric date day-first, the way it is written in India', () => {
    // The whole point: month-first would make this 3 December.
    expect(parseImportDate('12/03/2027')).toBe('2027-03-12')
    expect(parseImportDate('12-03-2027')).toBe('2027-03-12')
    expect(parseImportDate('12.3.2027')).toBe('2027-03-12')
    expect(parseImportDate('1/1/2027')).toBe('2027-01-01')
  })

  it('takes ISO as written, since that is the one unambiguous shape', () => {
    expect(parseImportDate('2027-03-12')).toBe('2027-03-12')
    expect(parseImportDate('2027-3-9')).toBe('2027-03-09')
  })

  it('reads a day above twelve without complaint', () => {
    expect(parseImportDate('28/02/2027')).toBe('2027-02-28')
  })

  it('reads a named month', () => {
    expect(parseImportDate('12 Mar 2027')).toBe('2027-03-12')
    expect(parseImportDate('12 March 2027')).toBe('2027-03-12')
    expect(parseImportDate('5-Dec-2026')).toBe('2026-12-05')
  })

  it('expands a two-digit year', () => {
    expect(parseImportDate('12/03/27')).toBe('2027-03-12')
    // 70 and above is the last century, so a date of birth does not land in 2075.
    expect(parseImportDate('12/03/85')).toBe('1985-03-12')
  })

  it('refuses a date that does not exist rather than rolling it forward', () => {
    expect(parseImportDate('31/02/2027')).toBeNull()
    expect(parseImportDate('32/01/2027')).toBeNull()
    expect(parseImportDate('12/13/2027')).toBeNull()
  })

  it('refuses anything it does not recognise, instead of guessing', () => {
    expect(parseImportDate('next Tuesday')).toBeNull()
    expect(parseImportDate('March 2027')).toBeNull()
    expect(parseImportDate('')).toBeNull()
    expect(parseImportDate(null)).toBeNull()
  })
})

describe('parseImportMoney', () => {
  it('reads Indian digit grouping and currency marks', () => {
    expect(parseImportMoney('1,50,000')).toBe(150000)
    expect(parseImportMoney('₹1,50,000')).toBe(150000)
    expect(parseImportMoney('Rs. 2,00,000')).toBe(200000)
    expect(parseImportMoney('INR 75000')).toBe(75000)
    expect(parseImportMoney('  90000  ')).toBe(90000)
    expect(parseImportMoney('1234.50')).toBe(1234.5)
  })

  it('refuses lakh shorthand rather than being wrong by a factor of 100,000', () => {
    expect(parseImportMoney('2.5L')).toBeNull()
    expect(parseImportMoney('2 lakh')).toBeNull()
  })

  it('refuses a cell it cannot read', () => {
    expect(parseImportMoney('to be discussed')).toBeNull()
    expect(parseImportMoney('-5000')).toBeNull()
    expect(parseImportMoney('')).toBeNull()
    expect(parseImportMoney(null)).toBeNull()
  })
})

describe('parseImportQuality', () => {
  it('accepts the words a spreadsheet actually uses', () => {
    expect(parseImportQuality('Hot')).toBe('hot')
    expect(parseImportQuality('HIGH')).toBe('hot')
    expect(parseImportQuality('medium')).toBe('warm')
    expect(parseImportQuality('Cold')).toBe('cold')
    expect(parseImportQuality('C')).toBe('cold')
  })

  it('leaves a lead unrated rather than inventing a rating', () => {
    expect(parseImportQuality('maybe')).toBeNull()
    expect(parseImportQuality(null)).toBeNull()
  })
})
