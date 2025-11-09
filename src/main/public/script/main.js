const { app, BrowserWindow } = require('electron')
const path = require('path')
const chokidar = require('chokidar')

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    })

    const htmlPath = path.join(__dirname, '../Chat.html')
    win.loadFile(htmlPath)

    // watch entire main folder (html, css, js)
    const watcher = chokidar.watch(path.join(__dirname, '../'))
    watcher.on('change', () => {
        win.reload()
    })
}

app.whenReady().then(() => {
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})
