'use client'

import { useState } from 'react'

export default function LoginPage() {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'phone' | 'code'>('phone')
  const [message, setMessage] = useState<string | null>(null)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    const res = await fetch('/api/v1/auth/otp/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone }),
    })
    if (res.ok) { setStage('code'); setMessage('Code sent. Check your messages.') }
    else setMessage((await res.json()).error ?? 'Could not send a code.')
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    const res = await fetch('/api/v1/auth/otp/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    })
    if (res.ok) window.location.href = '/'
    else setMessage((await res.json()).error ?? 'That code was not accepted.')
  }

  return (
    <main style={{ maxWidth: '24rem', marginInline: 'auto', padding: '2rem' }}>
      <h1>Sign in</h1>
      {stage === 'phone' ? (
        <form onSubmit={sendCode}>
          <label htmlFor="phone">Mobile number</label>
          <input id="phone" name="phone" type="tel" required
                 placeholder="+971 50 123 4567" value={phone}
                 onChange={(e) => setPhone(e.target.value)}
                 style={{ display: 'block', inlineSize: '100%', marginBlock: '0.5rem 1rem' }} />
          <button type="submit">Send code</button>
        </form>
      ) : (
        <form onSubmit={signIn}>
          <label htmlFor="code">Six-digit code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code"
                 required maxLength={6} value={code}
                 onChange={(e) => setCode(e.target.value)}
                 style={{ display: 'block', inlineSize: '100%', marginBlock: '0.5rem 1rem' }} />
          <button type="submit">Sign in</button>
        </form>
      )}
      {message !== null && <p role="status">{message}</p>}
    </main>
  )
}
