import { describe, expect, it } from 'vitest'

import { fakeJwt } from '@/test/factories'

import { decodeJwt } from './jwt'

describe('decodeJwt', () => {
  it('reads the role claim', () => {
    expect(decodeJwt(fakeJwt({ role: 'officer' }))?.role).toBe('officer')
  })

  it('handles base64url payloads with unicode', () => {
    expect(decodeJwt(fakeJwt({ role: 'citizen', email: 'ásha@example.com' }))?.email).toBe('ásha@example.com')
  })

  it.each([null, undefined, '', 'not-a-jwt', 'a.b', 'a.!!!.c'])('returns null for %s', (value) => {
    expect(decodeJwt(value as string | null | undefined)).toBeNull()
  })
})
