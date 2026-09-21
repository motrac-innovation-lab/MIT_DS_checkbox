// Punt 3 en 4 van "Productie-hardening" in CLAUDE.md, tot nu toe door niets
// bewaakt: mislukt het opstarten, dan mag het proces NIET stoppen (de
// cluster-wrapper zou het zonder backoff herstarten) maar moet het de poort
// openen in storingsmodus — /api/_health vertelt de oorzaak en elke andere
// route geeft een nette 503 STARTUP_FAILED.
//
// De CORS-headers zijn daarbij het hele punt: de storingsmodus-gate is ná
// cors() gemount, juist zodat de browser een échte foutmelding ziet en niet
// "Failed to fetch". Zonder die volgorde is de storing van buitenaf niet te
// onderscheiden van een kapotte koppeling.
import assert from 'node:assert/strict'
import test from 'node:test'
import { startBackend } from './helpers/server.js'
import { slaOverZonderDb } from './helpers/postgres.js'

test('storingsmodus: zonder DATABASE_URL blijft de poort open', { skip: slaOverZonderDb }, async (t) => {
  const backend = await startBackend({ extraEnv: { DATABASE_URL: null }, verwachteFase: 'mislukt' })
  t.after(() => backend.stop())

  const gezondheid = await backend.api('/api/_health')
  // 503, niet 200: /api/_health geeft bewust een foutstatus zodra het
  // opstarten mislukt is, zodat een uptime-monitor de storing ook ziet — de
  // body vertelt daarnaast de oorzaak.
  assert.equal(gezondheid.status, 503)
  assert.equal(gezondheid.json.fase, 'mislukt')
  assert.match(gezondheid.json.fout, /DATABASE_URL/)
  assert.equal(gezondheid.json.envAanwezig.DATABASE_URL, false)
  assert.equal(gezondheid.json.envAanwezig.MOTRAC_BEHEER_URL, true)

  const data = await backend.api('/api/data')
  assert.equal(data.status, 503)
  assert.equal(data.json.error.code, 'STARTUP_FAILED')
  assert.equal(
    data.headers.get('access-control-allow-origin'),
    'http://localhost:5173',
    'de 503 moet CORS-headers dragen, anders ziet de browser een CORS-fout i.p.v. de storing',
  )
})

test('storingsmodus lekt de connectiestring niet', { skip: slaOverZonderDb }, async (t) => {
  const backend = await startBackend({
    extraEnv: { DATABASE_URL: 'postgres://geheim:wachtwoord@nergens.invalid:5432/db' },
    verwachteFase: 'mislukt',
  })
  t.after(() => backend.stop())

  const gezondheid = await backend.api('/api/_health')
  assert.equal(gezondheid.json.fase, 'mislukt')
  // Het wachtwoord is hier de hele inzet: de foutmelding van de driver kan de
  // connectiestring bevatten, en /api/_health is onbeveiligd. server.js
  // redigeert daarom elke postgres-URL uit de opstartfout.
  assert.doesNotMatch(gezondheid.tekst, /wachtwoord/, 'het wachtwoord mag nooit in /api/_health staan')
  assert.doesNotMatch(gezondheid.tekst, /postgres:\/\//)

  const data = await backend.api('/api/data')
  assert.equal(data.status, 503)
  assert.doesNotMatch(data.tekst, /wachtwoord/)
})

test('/api/_health noemt nooit de waarde van een env-var', { skip: slaOverZonderDb }, async (t) => {
  const backend = await startBackend()
  t.after(() => backend.stop())

  const gezondheid = await backend.api('/api/_health')
  assert.equal(gezondheid.status, 200)
  assert.equal(gezondheid.json.fase, 'klaar')
  assert.doesNotMatch(gezondheid.tekst, /test-verify-key/)
})
