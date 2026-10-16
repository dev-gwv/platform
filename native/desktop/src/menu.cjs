'use strict'

/**
 * The menu bar. Edit carries Cut / Copy / Paste (on a Mac, without it the
 * keyboard shortcuts do nothing); Go jumps to the pages a studio opens most;
 * File prints or saves the page as a PDF -- a quotation or invoice comes out
 * on the studio's letterhead, as it does from the browser.
 */
function buildMenu({ app, isMac, go, openInBrowser, print, savePdf, about }) {
  const page = (label, path, accelerator) => ({ label, accelerator, click: () => go(path) })

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  template.push({
    label: 'File',
    submenu: [
      { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => print() },
      { label: 'Save page as PDF…', accelerator: 'CmdOrCtrl+Shift+S', click: () => savePdf() },
      { type: 'separator' },
      { label: 'Open this page in your browser', click: () => openInBrowser() },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
    ],
  })

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'selectAll' },
    ],
  })

  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Actual size' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      { role: 'toggleDevTools', label: 'Developer tools' },
    ],
  })

  template.push({
    label: 'Go',
    submenu: [
      { label: 'Back', accelerator: isMac ? 'Cmd+[' : 'Alt+Left', click: () => go('back') },
      { label: 'Forward', accelerator: isMac ? 'Cmd+]' : 'Alt+Right', click: () => go('forward') },
      { type: 'separator' },
      page('Home', '/dashboard', isMac ? 'Cmd+Shift+H' : 'Alt+Home'),
      page('Leads', '/leads', 'CmdOrCtrl+1'),
      page('Projects', '/projects', 'CmdOrCtrl+2'),
      page('Shoots', '/shoots', 'CmdOrCtrl+3'),
      page('Post-Production', '/production-board', 'CmdOrCtrl+4'),
      page('Tasks', '/tasks', 'CmdOrCtrl+5'),
      page('Money', '/billing/payments', 'CmdOrCtrl+6'),
    ],
  })

  template.push({
    label: 'Window',
    submenu: isMac
      ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'close' }],
  })

  template.push({
    role: 'help',
    submenu: [
      page('How to use Studio AutoPilot', '/learn'),
      page('Help & tutorials', '/help'),
      ...(isMac ? [] : [{ type: 'separator' }, { label: 'About Studio AutoPilot', click: () => about() }]),
    ],
  })

  return template
}

module.exports = { buildMenu }
