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

export function driverFromEnv(value: string | undefined): NotificationDriver {
  if (value === undefined || value === 'console') return consoleDriver
  throw new Error(
    `NOTIFY_DRIVER='${value}': no live notification provider is implemented yet. ` +
    `The SMS provider is deliberately undecided — implement a NotificationDriver ` +
    `and register it here before setting this.`,
  )
}
