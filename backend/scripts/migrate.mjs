// Past elk migrations/*.sql-bestand toe (op bestandsnaam-volgorde) tegen
// process.env.DATABASE_URL. Losse CLI-variant van dezelfde runMigrations()
// die server.js zelf ook bij opstarten draait (zie lib/migrate.js) — via
// makeDb() zodat deze ook profiteert van de multi-host/schrijfbare-host-
// resolutie in db.js. Niet meer strikt noodzakelijk vóór een eerste boot
// (server.js migreert nu zelf), maar handig om lokaal of los te draaien.
import 'dotenv/config'
import { makeDb } from '../db.js'
import { runMigrations } from '../lib/migrate.js'

async function main() {
  const db = await makeDb(process.env.DATABASE_URL)
  await runMigrations(db.sql)
  await db.sql.end()
}

main().catch((err) => {
  console.error('Migratie mislukt:', err)
  process.exit(1)
})
