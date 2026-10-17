'use strict'

const fs = require('node:fs')
const path = require('node:path')

/**
 * The window opens where it was last closed, at the same size and zoom.
 * A position on a screen that is no longer attached is dropped, so the window
 * never opens off-screen.
 */
const DEFAULTS = { width: 1366, height: 860, maximized: false, zoom: 0 }

function file(app) {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function load(app, screen) {
  let saved = {}
  try {
    saved = JSON.parse(fs.readFileSync(file(app), 'utf8'))
  } catch {
    saved = {}
  }
  const state = { ...DEFAULTS, ...saved }
  if (typeof state.x === 'number' && typeof state.y === 'number') {
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return state.x >= a.x - 40 && state.y >= a.y - 40 && state.x < a.x + a.width - 80 && state.y < a.y + a.height - 80
    })
    if (!visible) {
      delete state.x
      delete state.y
    }
  }
  return state
}

function save(app, win) {
  if (!win || win.isDestroyed()) return
  const maximized = win.isMaximized()
  const bounds = maximized ? win.getNormalBounds() : win.getBounds()
  const state = { ...bounds, maximized, zoom: win.webContents.getZoomLevel() }
  try {
    fs.mkdirSync(path.dirname(file(app)), { recursive: true })
    fs.writeFileSync(file(app), JSON.stringify(state))
  } catch {
    /* a read-only profile only loses the remembered size */
  }
}

module.exports = { load, save, DEFAULTS }
