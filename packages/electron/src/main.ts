// Extend Electron App type to hold a quit flag used by macOS hide-on-close logic
declare global {
  namespace Electron {
    interface App {
      isQuiting?: boolean
    }
  }
}

import { app, BrowserWindow, Tray, Menu, nativeImage, dialog } from 'electron'
import path from 'path'
import {
  ServerManager,
  getServerBinaryPath,
  getPublicDirPath,
  waitForReady,
} from './server-manager'

const PORT = 4242
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const serverManager = new ServerManager()

function createLoadingWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 400,
    height: 240,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0a',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    show: false,
  })
  win.loadFile(path.join(__dirname, '..', 'assets', 'loading.html'))
  win.once('ready-to-show', () => win.show())
  return win
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'GluePaste',
    backgroundColor: '#0a0a0a',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    show: false,
  })

  win.loadURL(`http://localhost:${PORT}`)
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })

  // macOS: hide window on close rather than quitting the whole app
  win.on('close', e => {
    if (process.platform === 'darwin' && !app.isQuiting) {
      e.preventDefault()
      win.hide()
    }
  })

  return win
}

function setupTray(): void {
  // Place a 1024x1024 PNG at packages/electron/assets/icon.png for a real icon.
  // Falls back to an empty icon (invisible tray) if not found.
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png')
  const rawIcon = nativeImage.createFromPath(iconPath)
  const icon = rawIcon.isEmpty()
    ? nativeImage.createEmpty()
    : rawIcon.resize({ width: 16, height: 16 })

  tray = new Tray(icon)
  tray.setToolTip('GluePaste')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open GluePaste',
        click: () => {
          mainWindow?.show()
          mainWindow?.focus()
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.isQuiting = true
          app.quit()
        },
      },
    ])
  )
  tray.on('double-click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

async function startApp(): Promise<void> {
  const serverBin = getServerBinaryPath(
    app.isPackaged,
    app.getAppPath(),
    process.resourcesPath
  )
  const publicDir = getPublicDirPath(
    app.isPackaged,
    app.getAppPath(),
    process.resourcesPath
  )

  console.log(`[electron] server binary: ${serverBin}`)
  console.log(`[electron] public dir: ${publicDir}`)

  const loadingWin = createLoadingWindow()
  const logDir = app.getPath('logs')
  console.log(`[electron] log dir: ${logDir}`)
  serverManager.start(serverBin, publicDir, logDir)

  const ready = await waitForReady(20000)

  if (!ready) {
    dialog.showErrorBox(
      'GluePaste failed to start',
      `The server did not respond within 20 seconds.\n\nExpected binary at:\n${serverBin}\n\nCheck that the app was built correctly.`
    )
    app.quit()
    return
  }

  mainWindow = createMainWindow()
  setupTray()
  loadingWin.close()
}

// Prevent running two instances simultaneously
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    mainWindow?.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })
}

process.on('uncaughtException', (err) => {
  try {
    const fs = require('fs') as typeof import('fs')
    const p = path.join(app.getPath('logs'), 'main-crash.log')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.appendFileSync(p, `${new Date().toISOString()} uncaught: ${err.stack ?? String(err)}\n`)
  } catch {}
  console.error('[electron] uncaught:', err)
})

app.whenReady().then(startApp).catch(err => {
  try {
    const fs = require('fs') as typeof import('fs')
    const p = path.join(app.getPath('logs'), 'main-crash.log')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.appendFileSync(p, `${new Date().toISOString()} startup: ${err.stack ?? String(err)}\n`)
  } catch {}
  console.error('[electron] startup error:', err)
  app.quit()
})

// Non-macOS: quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    serverManager.stop()
    app.quit()
  }
})

// macOS: re-open window when clicking dock icon
app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show()
  }
})

// Always stop server before process exits
app.on('before-quit', () => {
  serverManager.stop()
})
