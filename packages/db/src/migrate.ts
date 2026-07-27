import 'dotenv/config'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDb } from './client.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

await migrate(createDb(url), { migrationsFolder: './migrations' })
console.log('Migrations applied.')
process.exit(0)
