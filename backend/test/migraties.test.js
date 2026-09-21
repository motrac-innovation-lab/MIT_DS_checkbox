// Elke migratie draait bij ELKE boot opnieuw (zie lib/migrate.js). Eén
// niet-idempotent statement is dus geen migratieprobleem maar een
// opstart-crash voor elke replica bij de eerstvolgende herstart.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import postgres from 'postgres'
import { runMigrations } from '../lib/migrate.js'
import { maakTestDatabase, slaOverZonderDb } from './helpers/postgres.js'

const migratieDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

test('migraties zijn idempotent: drie keer draaien slaagt', { skip: slaOverZonderDb }, async (t) => {
  const database = await maakTestDatabase()
  t.after(() => database.opruimen())
  const sql = postgres(database.url, { max: 2, onnotice: () => {} })
  t.after(() => sql.end({ timeout: 5 }))

  await runMigrations(sql)
  await runMigrations(sql)
  await runMigrations(sql)

  const rijen = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  const tabellen = new Set(rijen.map((r) => r.table_name))
  for (const tabel of ['config', 'audit_log', 'conversies']) {
    assert.ok(tabellen.has(tabel), `tabel ${tabel} ontbreekt na migreren`)
  }
})

test('elke migratie zit in de reeks, zonder gaten of dubbele nummers', async () => {
  const bestanden = (await fs.readdir(migratieDir)).filter((f) => f.endsWith('.sql')).sort()
  const nummers = bestanden.map((f) => {
    const match = f.match(/^(\d{4})_/)
    assert.ok(match, `migratie zonder viercijferig volgnummer: ${f}`)
    return Number(match[1])
  })
  assert.deepEqual(nummers, [...nummers].sort((a, b) => a - b), 'bestandsnaam-volgorde is de uitvoervolgorde')
  assert.equal(new Set(nummers).size, nummers.length, 'dubbel migratienummer')
  assert.deepEqual(nummers, nummers.map((_, i) => i + 1), 'gat in de migratiereeks')
})
