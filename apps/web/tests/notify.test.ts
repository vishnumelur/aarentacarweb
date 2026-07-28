import { describe, it, expect, vi } from 'vitest'
import {
  consoleDriver, createRecordingDriver, driverFromEnv, type OutboundMessage,
} from '../src/auth/notify.js'

describe('notification driver', () => {
  it('records what was sent, so tests assert on real behaviour not a mock', async () => {
    const driver = createRecordingDriver()
    const msg: OutboundMessage = { channel: 'sms', to: '+971501234567', body: 'Your code is 123456' }
    await driver.send(msg)
    expect(driver.sent).toHaveLength(1)
    expect(driver.sent[0]).toEqual(msg)
  })

  it('records every message in order', async () => {
    const driver = createRecordingDriver()
    await driver.send({ channel: 'sms', to: '+971500000001', body: 'first' })
    await driver.send({ channel: 'whatsapp', to: '+971500000002', body: 'second' })
    expect(driver.sent.map((m) => m.body)).toEqual(['first', 'second'])
  })

  it('console driver writes rather than reaching a real phone', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await consoleDriver.send({ channel: 'sms', to: '+971501234567', body: 'Your code is 999111' })
    expect(spy).toHaveBeenCalled()
    const line = spy.mock.calls.flat().join(' ')
    expect(line).toContain('+971501234567')
    expect(line).toContain('999111')
    spy.mockRestore()
  })

  it('defaults to the console driver when NOTIFY_DRIVER is unset', () => {
    expect(driverFromEnv(undefined)).toBe(consoleDriver)
    expect(driverFromEnv('console')).toBe(consoleDriver)
  })

  it('refuses to start with a live driver that has no implementation yet', () => {
    // The SMS provider is deliberately undecided. Selecting it must fail loudly at
    // startup rather than silently swallowing every OTP a customer waits for.
    expect(() => driverFromEnv('live')).toThrow(/no live notification provider/i)
  })
})
