'use strict'

/**
 * Right-click, the way a browser does it. Electron ships with none, so
 * without this nobody could paste a client's phone number into a form.
 * Spelling suggestions first, then the link or image under the pointer, then
 * Cut / Copy / Paste.
 */
function attachContextMenu(contents, { Menu, BrowserWindow, clipboard, openOutside }) {
  contents.on('context-menu', (_event, p) => {
    const items = []
    const sep = { type: 'separator' }

    if (p.misspelledWord) {
      for (const word of (p.dictionarySuggestions || []).slice(0, 5)) {
        items.push({ label: word, click: () => contents.replaceMisspelling(word) })
      }
      if (items.length === 0) items.push({ label: 'No spelling suggestions', enabled: false })
      items.push({
        label: 'Add to dictionary',
        click: () => contents.session.addWordToSpellCheckerDictionary(p.misspelledWord),
      })
      items.push(sep)
    }

    if (p.linkURL) {
      items.push({ label: 'Open link in browser', click: () => openOutside(p.linkURL) })
      items.push({ label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) })
      items.push(sep)
    }

    if (p.mediaType === 'image' && p.srcURL) {
      items.push({ label: 'Copy image', click: () => contents.copyImageAt(p.x, p.y) })
      items.push({ label: 'Save image as…', click: () => contents.downloadURL(p.srcURL) })
      items.push(sep)
    }

    const f = p.editFlags || {}
    if (p.isEditable) {
      items.push({ role: 'undo', enabled: !!f.canUndo })
      items.push({ role: 'redo', enabled: !!f.canRedo })
      items.push(sep)
      items.push({ role: 'cut', enabled: !!f.canCut })
      items.push({ role: 'copy', enabled: !!f.canCopy })
      items.push({ role: 'paste', enabled: !!f.canPaste })
      items.push({ role: 'selectAll' })
    } else if (p.selectionText && p.selectionText.trim()) {
      items.push({ role: 'copy' })
    }

    // No separator at either end, and never two in a row.
    const tidy = items.filter((item, i, all) => {
      if (item.type !== 'separator') return true
      return i > 0 && i < all.length - 1 && all[i - 1].type !== 'separator'
    })
    if (tidy.length === 0) return
    Menu.buildFromTemplate(tidy).popup({ window: BrowserWindow.fromWebContents(contents) || undefined })
  })
}

module.exports = { attachContextMenu }
