'use strict'

const { contextBridge, ipcRenderer } = require('electron')

/**
 * The little the page learns about the app around it. The web app works the
 * same with or without this; it only lets a page tell it is in the desktop app
 * (window.studioAutopilotDesktop.isDesktop) and lets the offline page retry.
 * Nothing here can read files or run commands.
 */
const version = (process.argv.find((a) => a.startsWith('--sa-version=')) || '').slice('--sa-version='.length)

contextBridge.exposeInMainWorld('studioAutopilotDesktop', {
  isDesktop: true,
  platform: process.platform,
  version,
  retry: () => ipcRenderer.send('desktop:retry'),
})
