export type NotificationChannel = 'sms' | 'whatsapp' | 'email'

export interface OutboundMessage {
  readonly channel: NotificationChannel
  readonly to: string
  readonly body: string
}

export interface NotificationDriver {
  send(message: OutboundMessage): Promise<void>
}

/**
 * Development default. Writes to the console so a background job under test never
 * messages a real customer, and so an OTP is visible without an SMS account.
 */
export const consoleDriver: NotificationDriver = {
  async send(message) {
    console.info(`[notify:${message.channel}] to ${message.to}: ${message.body}`)
  },
}

/** Used by tests. Asserting on `sent` is asserting on behaviour, not on a mock. */
export function createRecordingDriver(): NotificationDriver & { sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = []
  return {
    sent,
    async send(message) { sent.push(message) },
  }
}

/**
 * Mirrors the guard `src/db.ts`'s `connectionString()` places on
 * `DATABASE_URL_TEST`: a variable that is safe to default in development
 * becomes a fatal misconfiguration in production, and the app refuses to
 * start rather than silently doing the unsafe thing.
 *
 * Left unset, this defaults to `consoleDriver` — which logs the full OTP to
 * the server's stdout. That is exactly what a developer wants locally and
 * exactly what a real deployment must never do: every customer's live login
 * code would land in production logs. So in production `NOTIFY_DRIVER` must
 * be set explicitly (to `'console'` if that is truly still intended, though
 * that would be an unusual choice) — an *unset* variable is refused outright.
 */
export function driverFromEnv(value: string | undefined): NotificationDriver {
  if (value === undefined) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'NOTIFY_DRIVER is not set in a production environment. Refusing to start — ' +
        "the default console driver would print every customer's OTP code to the " +
        'server logs. Set NOTIFY_DRIVER explicitly.',
      )
    }
    return consoleDriver
  }
  if (value === 'console') return consoleDriver
  throw new Error(
    `NOTIFY_DRIVER='${value}': no live notification provider is implemented yet. ` +
    `The SMS provider is deliberately undecided — implement a NotificationDriver ` +
    `and register it here before setting this.`,
  )
}
