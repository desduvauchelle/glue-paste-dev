import { describe, it, expect } from 'vitest'
import path from 'path'
import { getServerBinaryPath, getPublicDirPath } from './server-manager'

describe('getServerBinaryPath', () => {
  it('returns resources/server relative to appPath when not packaged', () => {
    const result = getServerBinaryPath(false, '/project/packages/electron')
    expect(result).toBe(path.join('/project/packages/electron', 'resources', 'server'))
  })

  it('returns resourcesPath/server when packaged', () => {
    const result = getServerBinaryPath(true, '/project/packages/electron', '/app/Contents/Resources')
    expect(result).toBe(path.join('/app/Contents/Resources', 'server'))
  })
})

describe('getPublicDirPath', () => {
  it('returns resources/public relative to appPath when not packaged', () => {
    const result = getPublicDirPath(false, '/project/packages/electron')
    expect(result).toBe(path.join('/project/packages/electron', 'resources', 'public'))
  })

  it('returns resourcesPath/public when packaged', () => {
    const result = getPublicDirPath(true, '/project/packages/electron', '/app/Contents/Resources')
    expect(result).toBe(path.join('/app/Contents/Resources', 'public'))
  })
})
