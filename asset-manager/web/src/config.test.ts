import { describe, expect, it } from 'vitest'
import { getProjectNumber } from './config'

/**
 * The project number feeds Picker.setAppId. If it comes out wrong the picker
 * still opens and returns a file, but the drive.file grant never attaches and
 * every later Sheets call fails with a bare 404 — a silent failure worth
 * pinning down.
 */
describe('getProjectNumber', () => {
  it('takes the leading digit group of the client ID', () => {
    expect(getProjectNumber('123456789012-abc123def.apps.googleusercontent.com')).toBe('123456789012')
    expect(getProjectNumber('  443133069542-xyz.apps.googleusercontent.com  ')).toBe('443133069542')
  })

  it('returns empty for anything that is not a client ID', () => {
    expect(getProjectNumber('')).toBe('')
    expect(getProjectNumber('AIzaSyExampleKeyValue')).toBe('')
    expect(getProjectNumber('abc-123.apps.googleusercontent.com')).toBe('')
    // A client ID pasted without its leading number.
    expect(getProjectNumber('-abc123.apps.googleusercontent.com')).toBe('')
  })
})
