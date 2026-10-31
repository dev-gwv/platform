import { describe, expect, it } from 'vitest'
import type { DriveImport, DriveItem } from '@ipc/contracts'
import { albumGroups, finishedLine, importLine, importRequest, importShare, leftOut } from './drive-import'

const photo = (id: string, folder: string | null, over: Partial<DriveItem> = {}): DriveItem => ({
  id,
  name: `${id}.JPG`,
  mime_type: 'image/jpeg',
  size: 100,
  folder_path: folder,
  importable: true,
  reason: null,
  ...over,
})

const picked = [
  photo('h1', 'Haldi'),
  photo('h2', 'Haldi'),
  photo('c1', 'Haldi/Candids'),
  photo('raw', 'Haldi', { importable: false, reason: 'RAW and other camera files aren’t imported yet' }),
  photo('vid', 'Haldi', { importable: false, reason: 'Videos aren’t imported' }),
  photo('one', null),
]

describe('what was picked becomes albums', () => {
  it('one album per folder, subfolders apart, loose photos together', () => {
    expect(albumGroups(picked).map((g) => [g.label, g.album, g.count])).toEqual([
      ['Haldi', 'Haldi', 2],
      ['Haldi/Candids', 'Haldi – Candids', 1],
      ['Photos you picked', 'From Google Drive', 1],
    ])
  })

  it('takes the studio’s own album name, and falls back when it is cleared', () => {
    expect(albumGroups(picked, { Haldi: '  Haldi ceremony ', '': '   ' }).map((g) => g.album)).toEqual(['Haldi ceremony', 'Haldi – Candids', 'From Google Drive'])
  })

  it('says what is left out and why', () => {
    expect(leftOut(picked)).toBe('1 · RAW and other camera files aren’t imported yet; 1 · Videos aren’t imported')
    expect(leftOut([photo('a', null)])).toBeNull()
  })

  it('sends only photos Frameline can take, each with its album', () => {
    const req = importRequest(picked, albumGroups(picked, { Haldi: 'Haldi ceremony' }), 'original')
    expect(req.name).toBe('Haldi and 2 more')
    expect(req.quality).toBe('original')
    expect(req.items.map((i) => [i.file_id, i.album_name])).toEqual([
      ['h1', 'Haldi ceremony'],
      ['h2', 'Haldi ceremony'],
      ['c1', 'Haldi – Candids'],
      ['one', 'From Google Drive'],
    ])
  })
})

describe('an import in a sentence', () => {
  const run: DriveImport = {
    id: 'di_1', name: 'Haldi', status: 'running', total: 120, done: 40, skipped: 2, failed: 0, albums_created: 1,
    quality: 'web', created_at: '2026-10-31T10:00:00Z', finished_at: null, error: null,
  }

  it('reads how far it has got', () => {
    expect(importLine(run)).toBe('40 of 120 photos in · 2 skipped')
    expect(importShare(run)).toBeCloseTo(0.35)
  })

  it('says once how it ended', () => {
    expect(finishedLine({ ...run, status: 'done', done: 118 })).toBe('118 photos imported from Google Drive · 2 skipped (already in the gallery, or not a photo).')
    expect(finishedLine({ ...run, status: 'cancelled' })).toBe('Import stopped. 40 photos came in.')
    expect(finishedLine({ ...run, status: 'failed', error: 'Reconnect Google Drive' })).toContain('Reconnect Google Drive')
  })
})
