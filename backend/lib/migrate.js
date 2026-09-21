// Herbruikbare migratie-runner: past elk bestand in migrations/ toe op de
// gegeven postgres.js-client, in bestandsnaam-volgorde. Gebruikt door zowel
// scripts/migrate.mjs (losse CLI-aanroep) als server.js (zelf-migrerend bij
// opstarten — nodig omdat het deploy-platform altijd rechtstreeks
// `node server.js` draait en `package.json`'s `start`-script/`npm start`
// niet gebruikt, dus een los migratie-commando kwam daar nooit tot uitvoer).
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

// Eén worker tegelijk laten migreren. Het deploy-platform draait cluster mode
// (een worker per CPU-core) en élke worker draait deze loop bij het opstarten
// tegen dezelfde database. Zonder onderlinge afstemming grijpen ze elkaar in de
// rede op dezelfde DDL en sneuvelt er één met `deadlock detected`; die worker
// gaat dan in storingsmodus en blijft 503's geven voor zijn deel van het
// verkeer. Dat gebeurde op 2026-08-13 live bij Motrac-beheer.
//
// pg_advisory_lock is SESSIE-gebonden: de lock, de migraties en de unlock
// moeten over dezelfde verbinding lopen. Met een pool kunnen dat drie
// verschillende verbindingen zijn en beschermt het niets — vandaar
// sql.reserve(), dat één vaste verbinding uitgeeft tot we hem loslaten.
//
// De wachtende workers draaien de migraties daarna alsnog, en dat hoort zo: de
// bestanden zijn idempotent (IF NOT EXISTS / ON CONFLICT / EXCEPTION-vang), ze
// draaien nu alleen niet meer gelijktijdig.
const MIGRATIE_LOCK_ID = 20260813

export async function runMigrations(sql) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const db = await sql.reserve()
  try {
    await db`SELECT pg_advisory_lock(${MIGRATIE_LOCK_ID})`
    for (const file of files) {
      console.log(`→ ${file}`)
      const text = await readFile(path.join(dir, file), 'utf8')
      await db.unsafe(text)
    }
    console.log(`Klaar: ${files.length} migratie(s) toegepast.`)
  } finally {
    // Vrijgeven vóór release(): de verbinding gaat terug de pool in en zou de
    // lock anders vasthouden zolang het proces leeft. Als de unlock zelf
    // faalt is de verbinding stuk en geeft Postgres de lock bij het sluiten
    // vanzelf vrij — dat mag de echte fout uit de try niet overschaduwen.
    await db`SELECT pg_advisory_unlock(${MIGRATIE_LOCK_ID})`.catch(() => {})
    db.release()
  }
}
