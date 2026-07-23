import { describe, expect, it, vi } from 'vitest'
import { createBinaryInvocation, validateBinary } from './binary-runtime.js'

describe('createBinaryInvocation', () => {
  it('runs native Unix and Windows executables directly', () => {
    expect(createBinaryInvocation('/workspace/crux', 'linux')).toEqual({
      command: '/workspace/crux',
      argsPrefix: [],
    })
    expect(createBinaryInvocation('C:\\Crux\\crux.exe', 'win32')).toEqual({
      command: 'C:\\Crux\\crux.exe',
      argsPrefix: [],
    })
  })

  it('runs a Windows npm command shim through the command processor', () => {
    expect(
      createBinaryInvocation(
        'C:\\workspace\\node_modules\\.bin\\crux.cmd',
        'win32',
        'C:\\Windows\\cmd.exe',
      ),
    ).toEqual({
      command: 'C:\\Windows\\cmd.exe',
      argsPrefix: [
        '/d',
        '/s',
        '/c',
        'call',
        'C:\\workspace\\node_modules\\.bin\\crux.cmd',
      ],
    })
  })
})

describe('validateBinary', () => {
  it('returns non-empty version output from the selected invocation', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ stdout: 'crux 1.2.3\n', stderr: '' })

    await expect(
      validateBinary({ command: '/workspace/crux', argsPrefix: [] }, run),
    ).resolves.toBe('crux 1.2.3')
    expect(run).toHaveBeenCalledWith('/workspace/crux', ['--version'])
  })

  it('rejects failed and empty version probes before server startup', async () => {
    const failed = vi.fn().mockRejectedValue(new Error('exit 1'))
    const empty = vi.fn().mockResolvedValue({ stdout: '', stderr: '  ' })

    await expect(
      validateBinary({ command: '/bad/crux', argsPrefix: [] }, failed),
    ).rejects.toThrow('Unable to run Crux binary /bad/crux: exit 1')
    await expect(
      validateBinary({ command: '/empty/crux', argsPrefix: [] }, empty),
    ).rejects.toThrow(
      'Unable to run Crux binary /empty/crux: empty version output',
    )
  })
})
