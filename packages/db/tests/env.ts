import { resolve } from 'node:path'
import { config } from 'dotenv'
import { afterAll } from 'vitest'
import { closeAllPools } from '../src/client.js'

config({ path: resolve(import.meta.dirname, '../../../.env') })

afterAll(async () => {
  await closeAllPools()
})
