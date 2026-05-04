import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'

const PORT = 4242

export function getServerBinaryPath(
  isPackaged: boolean,
  appPath: string,
  resourcesPath?: string
): string {
  if (isPackaged && resourcesPath) {
    return path.join(resourcesPath, 'server')
  }
  return path.join(appPath, 'resources', 'server')
}

export function getPublicDirPath(
  isPackaged: boolean,
  appPath: string,
  resourcesPath?: string
): string {
  if (isPackaged && resourcesPath) {
    return path.join(resourcesPath, 'public')
  }
  return path.join(appPath, 'resources', 'public')
}

export async function waitForReady(timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/boards`)
      if (res.ok) return true
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 200))
  }
  return false
}

export class ServerManager {
  private process: ChildProcess | null = null
  private logStream: fs.WriteStream | null = null

  start(serverBin: string, publicDir: string, logDir?: string): void {
    if (logDir) {
      try {
        fs.mkdirSync(logDir, { recursive: true })
        const logPath = path.join(logDir, 'sidecar.log')
        this.logStream = fs.createWriteStream(logPath, { flags: 'a' })
        const stamp = new Date().toISOString()
        this.logStream.write(
          `\n=== ${stamp} starting sidecar ===\n` +
          `bin: ${serverBin}\n` +
          `publicDir: ${publicDir}\n` +
          `binExists: ${fs.existsSync(serverBin)}\n`
        )
      } catch (e) {
        console.error('[electron] failed to open sidecar log:', e)
      }
    }

    const writeLog = (line: string): void => {
      this.logStream?.write(line.endsWith('\n') ? line : line + '\n')
      process.stdout.write(line.endsWith('\n') ? line : line + '\n')
    }

    try {
      this.process = spawn(serverBin, [], {
        env: { ...process.env, PORT: String(PORT), GPD_PUBLIC_DIR: publicDir },
        stdio: 'pipe',
      })
    } catch (e) {
      writeLog(`[electron] spawn threw synchronously: ${String(e)}`)
      throw e
    }

    writeLog(`[electron] spawn pid=${String(this.process.pid)}`)

    this.process.on('error', (err) => {
      writeLog(`[electron] sidecar error event: ${err.stack ?? String(err)}`)
    })
    this.process.stdout?.on('data', (d: Buffer) => {
      this.logStream?.write(d)
      process.stdout.write(d)
    })
    this.process.stderr?.on('data', (d: Buffer) => {
      this.logStream?.write(d)
      process.stderr.write(d)
    })
    this.process.on('exit', (code, signal) => {
      writeLog(`[electron] sidecar exited (code=${String(code)} signal=${String(signal)})`)
      this.process = null
    })
  }

  stop(): void {
    if (!this.process) return
    this.process.kill('SIGTERM')
    this.process = null
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }
}
