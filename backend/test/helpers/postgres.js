// test/helpers/postgres.js — een wegwerp-database per testbestand.
//
// De DB-tests draaien alleen als TEST_DATABASE_URL gezet is (in CI de
// postgres-service uit .github/workflows/ci.yml, lokaal een eigen instantie).
// Ontbreekt hij, dan worden die tests overgeslagen in plaats van te falen: de
// pure-logica-tests moeten ook zonder database groen draaien, anders wordt de
// suite lokaal genegeerd en daarmee waardeloos.
import { randomBytes } from 'node:crypto'
import postgres from 'postgres'

export const HEEFT_DB = Boolean(process.env.TEST_DATABASE_URL)
export const slaOverZonderDb = HEEFT_DB
  ? false
  : 'TEST_DATABASE_URL niet gezet — databasetests overgeslagen'

function basisUrl() {
  if (!HEEFT_DB) throw new Error('TEST_DATABASE_URL ontbreekt')
  return new URL(process.env.TEST_DATABASE_URL)
}

/**
 * Maakt een lege database met een unieke naam en geeft de connectiestring
 * terug plus een opruimfunctie. Een eigen database per testbestand i.p.v. een
 * gedeelde met TRUNCATE ertussen: de migratierunner draait CREATE TABLE en de
 * pakbon-teller hangt aan een rij-lock, dus tests moeten elkaar niet in
 * dezelfde tabellen tegenkomen.
 */
export async function maakTestDatabase() {
  const url = basisUrl()
  const naam = `dscheckbox_test_${randomBytes(6).toString('hex')}`
  const beheer = postgres(url.toString(), { max: 1, onnotice: () => {} })
  try {
    await beheer.unsafe(`CREATE DATABASE "${naam}"`)
  } finally {
    await beheer.end({ timeout: 5 })
  }

  const testUrl = new URL(url.toString())
  testUrl.pathname = `/${naam}`

  return {
    url: testUrl.toString(),
    naam,
    async opruimen() {
      const opruimer = postgres(url.toString(), { max: 1, onnotice: () => {} })
      try {
        await opruimer.unsafe(`DROP DATABASE IF EXISTS "${naam}" WITH (FORCE)`)
      } finally {
        await opruimer.end({ timeout: 5 })
      }
    },
  }
}
