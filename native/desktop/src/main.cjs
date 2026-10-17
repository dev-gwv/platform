'use strict'

/**
 * Studio AutoPilot for Windows, Mac and Linux.
 *
 * The app is the live site (https://studioautopilot.in) in a window of its own,
 * so every feature the web app has -- and every one it gains -- is here on the
 * next launch, with no new installer. What this file adds is what a browser
 * would otherwise do: links that belong in WhatsApp, the mail app or the
 * dialler go there; Facebook and Google sign-in stay inside the app so they can
 * hand their answer back; files land in Downloads; a dropped connection shows
 * a page that retries by itself; the window remembers its size; and the menu
 * bar prints, saves a PDF and jumps to the pages a studio opens most.
 *
 * The page gets no Node: context isolation, the sandbox and a two-function
 * preload (preload.cjs). Microphone, location and notifications are granted to
 * our own site alone.
 */

const path = require('node:path')
const fs = require('node:fs')
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  session,
  shell,
  systemPreferences,
} = require('electron')

const { appOrigin, START_PATH } = require('./config.cjs')
const { classify, isAppOrigin, deepLinkTarget, SIGN_IN_HOSTS } = require('./links.cjs')
const windowState = require('./window-state.cjs')
const { buildMenu } = require('./menu.cjs')
const { attachContextMenu } = require('./context-menu.cjs')

const ORIGIN = appOrigin()
const START_URL = `${ORIGIN}${START_PATH}`
const PROTOCOL = 'studioautopilot'
const isMac = process.platform === 'darwin'
const PRELOAD = path.join(__dirname, 'preload.cjs')
const OFFLINE = path.join(__dirname, 'offline.html')
/** Test runs print where a link would have gone instead of opening it (no browser in CI). */
const DRY_EXTERNAL = process.env.SA_DESKTOP_DRY_EXTERNAL === '1'

/** What each window is for: 'app' (our site), 'sign-in' (a Facebook/Google popup) or 'pending' (window.open('') waiting for its address). */
const roles = new WeakMap()
/** The address a window was on when the connection dropped, for Try again. */
const lastTarget = new WeakMap()

let mainWindow = null
/** A studioautopilot:// link that arrived before the window was ready. */
let pendingDeepLink = null

// ---------------------------------------------------------------- start-up

if (!app.requestSingleInstanceLock()) {
  // A second launch (or a studioautopilot:// link) goes to the window already open.
  app.quit()
} else {
  app.setName('Studio AutoPilot')
  if (process.platform === 'win32') app.setAppUserModelId('in.studioautopilot.desktop')
  registerProtocol()
  pendingDeepLink = findDeepLink(process.argv)

  app.on('second-instance', (_event, argv) => {
    const link = findDeepLink(argv)
    focusMain()
    if (link) openDeepLink(link)
  })
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (mainWindow) openDeepLink(url)
    else pendingDeepLink = url
  })

  app.whenReady().then(start)
  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else focusMain()
  })
  app.on('web-contents-created', (_event, contents) => guard(contents))
}

function start() {
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback)
  app.setAboutPanelOptions({
    applicationName: 'Studio AutoPilot',
    applicationVersion: app.getVersion(),
    copyright: '© Grateful World Ventures (OPC) Private Limited',
    website: ORIGIN,
  })
  setUpSession(session.defaultSession)
  ipcMain.on('desktop:retry', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) win.loadURL(lastTarget.get(win.webContents) || START_URL)
  })
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenu({
        app,
        isMac,
        go,
        openInBrowser: () => {
          const url = focusedContents()?.getURL()
          openOutside(url && isAppOrigin(url, ORIGIN) ? url : START_URL)
        },
        print: () => focusedContents()?.print({ printBackground: true }),
        savePdf,
        about,
      }),
    ),
  )
  createMainWindow()
}

/**
 * Chrome's own user agent, without the "Electron/…" and app tokens: Google's
 * sign-in turns away browsers it does not recognise, and the site needs nothing
 * from the token (a page that wants to know asks window.studioAutopilotDesktop).
 */
function cleanUserAgent(ua) {
  const names = new Set([app.getName(), 'Studio AutoPilot', 'studio-autopilot-desktop'])
  let out = ua.replace(/\sElectron\/\S+/, '')
  for (const name of names) out = out.split(` ${name}/${app.getVersion()}`).join('')
  return out
}

// ------------------------------------------------------------------ windows

function windowOptions(extra = {}) {
  return {
    title: 'Studio AutoPilot',
    icon: path.join(__dirname, '..', 'resources', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b1220' : '#ffffff',
    autoHideMenuBar: false,
    ...extra,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true,
      additionalArguments: [`--sa-version=${app.getVersion()}`],
      ...(extra.webPreferences || {}),
    },
  }
}

function createMainWindow() {
  const state = windowState.load(app, screen)
  const win = new BrowserWindow(
    windowOptions({
      width: state.width,
      height: state.height,
      x: state.x,
      y: state.y,
      minWidth: 380,
      minHeight: 560,
      show: false,
    }),
  )
  mainWindow = win
  roles.set(win.webContents, 'app')
  if (state.maximized) win.maximize()

  // Shown when the page has painted, or after three seconds on a slow line.
  let shown = false
  const show = () => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.show()
  }
  win.once('ready-to-show', show)
  setTimeout(show, 3000)

  win.webContents.on('dom-ready', () => {
    if (state.zoom) win.webContents.setZoomLevel(state.zoom)
  })

  let saveTimer = null
  const saveSoon = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => windowState.save(app, win), 500)
  }
  win.on('resize', saveSoon)
  win.on('move', saveSoon)
  win.on('close', () => windowState.save(app, win))
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  wireNavigationButtons(win)

  const link = pendingDeepLink && deepLinkTarget(pendingDeepLink, ORIGIN)
  pendingDeepLink = null
  win.loadURL(link || START_URL)
  return win
}

function focusMain() {
  if (!mainWindow) {
    createMainWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function focusedContents() {
  const win = BrowserWindow.getFocusedWindow() || mainWindow
  return win && !win.isDestroyed() ? win.webContents : null
}

/** The mouse's back/forward buttons (Windows, Linux) and a two-finger swipe (Mac). */
function wireNavigationButtons(win) {
  win.on('app-command', (_event, command) => {
    if (command === 'browser-backward') go('back')
    if (command === 'browser-forward') go('forward')
  })
  win.on('swipe', (_event, direction) => {
    if (direction === 'right') go('back')
    if (direction === 'left') go('forward')
  })
}

function go(where) {
  const contents = focusedContents()
  if (!contents) return
  const history = contents.navigationHistory
  if (where === 'back') {
    if (history.canGoBack()) history.goBack()
    return
  }
  if (where === 'forward') {
    if (history.canGoForward()) history.goForward()
    return
  }
  contents.loadURL(`${ORIGIN}${where}`)
}

// ------------------------------------------------------------------- links

function openOutside(url) {
  if (DRY_EXTERNAL) {
    console.log(`[external] ${url}`)
    return
  }
  shell.openExternal(url).catch(() => {})
}

/**
 * Every web page the app shows -- the main window, a popup, a pending tab --
 * goes through here: where its links open, what it may navigate to, what
 * happens when the connection drops.
 */
function guard(contents) {
  contents.on('will-attach-webview', (event) => event.preventDefault())

  contents.setWindowOpenHandler(({ url }) => {
    const kind = classify(url, ORIGIN)
    if (kind === 'app') return { action: 'allow', overrideBrowserWindowOptions: windowOptions(childBounds()) }
    if (kind === 'sign-in') return { action: 'allow', overrideBrowserWindowOptions: windowOptions(popupBounds()) }
    if (kind === 'blank') {
      // Shown only once the page tells it where to go (see decidePending).
      return { action: 'allow', overrideBrowserWindowOptions: windowOptions({ ...childBounds(), show: false }) }
    }
    if (kind === 'external') openOutside(url)
    return { action: 'deny' }
  })

  contents.on('did-create-window', (child, { url }) => {
    const kind = classify(url, ORIGIN)
    const role = kind === 'blank' ? 'pending' : kind === 'sign-in' ? 'sign-in' : 'app'
    roles.set(child.webContents, role)
    if (role === 'pending') {
      // A tab the page never pointed anywhere is closed after a minute.
      setTimeout(() => {
        if (!child.isDestroyed() && roles.get(child.webContents) === 'pending') child.destroy()
      }, 60_000)
    }
    if (role === 'app') wireNavigationButtons(child)
  })

  const onNavigate = (event, url) => {
    const role = roles.get(contents) || 'app'
    if (role === 'pending') {
      decidePending(contents, url, event)
      return
    }
    if (role === 'closing') {
      // Already sent where it belongs; this window only waits to close.
      event.preventDefault()
      return
    }
    const kind = classify(url, ORIGIN)
    if (kind === 'app' || kind === 'sign-in') return
    // Inside a sign-in (a popup, or the main window on its way through
    // Facebook), Facebook and Google move through their own pages and hand
    // back to us; any https step is theirs to take.
    if (kind === 'external' && url.startsWith('https://') && (role === 'sign-in' || onSignInPage(contents))) return
    event.preventDefault()
    if (kind === 'external') openOutside(url)
  }
  contents.on('will-navigate', onNavigate)
  contents.on('will-redirect', (event, url) => {
    // A redirect from a sign-in page (back to us, or on to another of its own
    // pages) is part of the sign-in; elsewhere the same rules as a click.
    if (roles.get(contents) === 'sign-in' || onSignInPage(contents)) return
    onNavigate(event, url)
  })
  // A tab opened with window.open('') and pointed somewhere by the page that
  // opened it reports did-start-navigation before will-navigate (if that comes
  // at all); this catches it before anything shows. Stopping the load from
  // inside this event crashes Electron, so a tab bound elsewhere is left to be
  // destroyed (decidePending) and will-navigate cancels the rest.
  contents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    if (roles.get(contents) === 'pending') decidePending(contents, details.url, null)
  })

  contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    // -3 is a load replaced by another (a click during a load): not a failure.
    if (!isMainFrame || code === -3) return
    if (roles.get(contents) !== 'app') return
    lastTarget.set(contents, url && url.startsWith('http') ? url : START_URL)
    contents.loadFile(OFFLINE).catch(() => {})
  })

  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    if (!contents.isDestroyed() && roles.get(contents) === 'app') contents.reload()
  })

  attachContextMenu(contents, { Menu, BrowserWindow, clipboard, openOutside })
}

function onSignInPage(contents) {
  try {
    const host = new URL(contents.getURL()).hostname
    return SIGN_IN_HOSTS.includes(host) || host.endsWith('.facebook.com') || host.endsWith('.google.com')
  } catch {
    return false
  }
}

/**
 * window.open('') then tab.location = … : the web app opens a tab at the press
 * (a browser blocks one opened after a wait) and points it at WhatsApp, the
 * gallery or a file once the server answers. Ours shows as an app window, a
 * sign-in as a popup, anything else goes to the browser or app it belongs in
 * and the empty window is closed.
 */
function decidePending(contents, url, event) {
  if (!url || url === 'about:blank') return
  const win = BrowserWindow.fromWebContents(contents)
  const kind = classify(url, ORIGIN)
  if (kind === 'app' || kind === 'sign-in') {
    roles.set(contents, kind)
    if (win && !win.isDestroyed()) {
      if (kind === 'sign-in') {
        const b = popupBounds()
        win.setBounds({ ...win.getBounds(), width: b.width, height: b.height })
        win.center()
      } else {
        wireNavigationButtons(win)
      }
      win.show()
    }
    return
  }
  roles.set(contents, 'closing')
  if (event) event.preventDefault()
  if (kind === 'external') openOutside(url)
  setImmediate(() => {
    if (win && !win.isDestroyed()) win.destroy()
  })
}

function childBounds() {
  const base = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : { width: 1200, height: 800 }
  return { width: Math.max(900, base.width - 80), height: Math.max(640, base.height - 60), minWidth: 380, minHeight: 480 }
}

function popupBounds() {
  return { width: 520, height: 720, minimizable: false, maximizable: false }
}

// -------------------------------------------------------------- deep links

function registerProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    // `electron .` in development: register the script, not electron itself.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }
}

function findDeepLink(argv) {
  return (argv || []).find((a) => typeof a === 'string' && a.startsWith(`${PROTOCOL}://`)) || null
}

function openDeepLink(raw) {
  const target = deepLinkTarget(raw, ORIGIN)
  if (!target) return
  focusMain()
  if (mainWindow) mainWindow.loadURL(target)
}

// ------------------------------------------------- session: permissions, files

function setUpSession(ses) {
  const ALLOWED = new Set([
    'media',
    'geolocation',
    'notifications',
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen',
    'pointerLock',
  ])

  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const from = details.requestingUrl || contents.getURL()
    if (permission === 'openExternal') {
      // mailto:, tel:, whatsapp: and the like from our own pages.
      callback(isAppOrigin(from, ORIGIN) && classify(details.externalURL || '', ORIGIN) === 'external')
      return
    }
    if (!ALLOWED.has(permission) || !isAppOrigin(from, ORIGIN)) {
      callback(false)
      return
    }
    if (permission === 'media' && isMac && (details.mediaTypes || []).includes('audio')) {
      // macOS asks once ("Studio AutoPilot would like to use the microphone").
      systemPreferences
        .askForMediaAccess('microphone')
        .then((ok) => callback(ok))
        .catch(() => callback(false))
      return
    }
    callback(true)
  })

  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    if (!ALLOWED.has(permission)) return false
    return isAppOrigin(requestingOrigin, ORIGIN)
  })

  if (!isMac) {
    // Indian English where the spell checker has it, else British English.
    const have = ses.availableSpellCheckerLanguages || []
    const pick = ['en-IN', 'en-GB', 'en-US'].filter((l) => have.includes(l)).slice(0, 2)
    if (pick.length) ses.setSpellCheckerLanguages(pick)
  }

  ses.on('will-download', (_event, item, contents) => {
    // Straight into Downloads, as Chrome does; a second copy gets " (1)".
    const target = uniquePath(downloadsDir(), item.getFilename() || 'download')
    item.setSavePath(target)
    const win = BrowserWindow.fromWebContents(contents) || mainWindow
    item.on('updated', () => {
      const total = item.getTotalBytes()
      if (win && !win.isDestroyed() && total > 0) win.setProgressBar(item.getReceivedBytes() / total)
    })
    item.once('done', (_e, state) => {
      if (win && !win.isDestroyed()) win.setProgressBar(-1)
      if (state !== 'completed') return
      if (isMac) app.dock?.downloadFinished(target)
      if (Notification.isSupported()) {
        const note = new Notification({ title: 'Downloaded', body: `${path.basename(target)} is in your Downloads folder.`, silent: true })
        note.on('click', () => shell.showItemInFolder(target))
        note.show()
      }
    })
  })
}

/** The Downloads folder; a Linux desktop without one set up gets ~/Downloads, as Chrome does, not the home folder. */
function downloadsDir() {
  const dir = app.getPath('downloads')
  if (dir !== app.getPath('home')) return dir
  const fallback = path.join(dir, 'Downloads')
  try {
    fs.mkdirSync(fallback, { recursive: true })
    return fallback
  } catch {
    return dir
  }
}

function uniquePath(dir, name) {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_')
  const ext = path.extname(safe)
  const stem = safe.slice(0, safe.length - ext.length)
  let candidate = path.join(dir, safe)
  for (let i = 1; fs.existsSync(candidate) && i < 1000; i++) candidate = path.join(dir, `${stem} (${i})${ext}`)
  return candidate
}

// ----------------------------------------------------------- menu actions

async function savePdf() {
  const contents = focusedContents()
  if (!contents) return
  const win = BrowserWindow.fromWebContents(contents)
  const title = (contents.getTitle() || 'Studio AutoPilot').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save page as PDF',
    defaultPath: path.join(downloadsDir(), `${title}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (canceled || !filePath) return
  try {
    // The page's own print styles apply: a quotation or invoice comes out as the paper.
    const pdf = await contents.printToPDF({ printBackground: true, pageSize: 'A4', preferCSSPageSize: true })
    fs.writeFileSync(filePath, pdf)
    shell.showItemInFolder(filePath)
  } catch (e) {
    dialog.showErrorBox('Could not save the PDF', String((e && e.message) || e))
  }
}

function about() {
  dialog.showMessageBox(mainWindow || undefined, {
    type: 'info',
    title: 'About Studio AutoPilot',
    message: 'Studio AutoPilot',
    detail: `Version ${app.getVersion()}\n${ORIGIN.replace(/^https?:\/\//, '')}\n\n© Grateful World Ventures (OPC) Private Limited`,
    buttons: ['OK'],
  })
}
