import { spawn, type ChildProcess } from 'child_process'
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

  start(serverBin: string): void {
    this.process = spawn(serverBin, [], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'pipe',
    })
    this.process.stdout?.on('data', (d: Buffer) => process.stdout.write(d))
    this.process.stderr?.on('data', (d: Buffer) => process.stderr.write(d))
    this.process.on('exit', (code, signal) => {
      console.log(`[electron] Server exited (code=${String(code)} signal=${String(signal)})`)
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
