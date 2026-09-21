// De auth-grens en de mount-volgorde. CLAUDE.md is er expliciet over dat
// rollen server-side worden afgedwongen en niet alleen in de UI — deze test
// controleert dat, met een gewoon gebruikerstoken tegen elke beheerder-route.
import assert from 'node:assert/strict'
import test, { after, before, describe } from 'node:test'
import { startBackend, TOKEN_ADMIN, TOKEN_GEBRUIKER } from './helpers/server.js'
import { slaOverZonderDb } from './helpers/postgres.js'

let backend
before(async () => { if (!slaOverZonderDb) backend = await startBackend() })
after(async () => { if (backend) await backend.stop() })

describe('bearer-auth', { skip: slaOverZonderDb }, () => {
  test('zonder token is elke /api-route dicht', async () => {
    const res = await backend.api('/api/data')
    assert.equal(res.status, 401)
    assert.equal(res.json.error.code, 'UNAUTHENTICATED')
  })

  test('een token dat Motrac-beheer niet kent is dicht', async () => {
    const res = await backend.api('/api/data', { token: 'onzin-token' })
    assert.equal(res.status, 401)
  })

  test('een geldig token opent de bootstrap-route', async () => {
    const res = await backend.api('/api/data', { token: TOKEN_GEBRUIKER })
    assert.equal(res.status, 200)
    assert.ok('config' in res.json, '/api/data mist config')
  })

  test('het verify-resultaat wordt gecachet — niet elk verzoek belt Motrac-beheer', async () => {
    const voor = backend.beheerVerzoeken.length
    await backend.api('/api/data', { token: TOKEN_GEBRUIKER })
    await backend.api('/api/data', { token: TOKEN_GEBRUIKER })
    await backend.api('/api/data', { token: TOKEN_GEBRUIKER })
    assert.ok(
      backend.beheerVerzoeken.length - voor <= 1,
      `verwacht hooguit één verify-call, kreeg er ${backend.beheerVerzoeken.length - voor}`,
    )
  })

  test('/api/data geeft MOTRAC_VERIFY_KEY nooit terug', async () => {
    const res = await backend.api('/api/data', { token: TOKEN_ADMIN })
    assert.ok(!Object.keys(res.json.config).includes('MOTRAC_VERIFY_KEY'))
  })

  test('een onbekend /api-pad is een nette 404 en geen HTML', async () => {
    const res = await backend.api('/api/bestaat-niet', { token: TOKEN_GEBRUIKER })
    assert.equal(res.status, 404)
    assert.equal(res.json.error.code, 'NOT_FOUND')
  })
})

describe('requireAdmin', { skip: slaOverZonderDb }, () => {
  // Elke beheerder-only route hoort hier te staan; een nieuwe admin-route
  // zonder regel hier is een gat in de test.
  const BEHEERDERROUTES = [
    ['GET', '/api/audit-log'],
    ['PUT', '/api/config/iets'],
  ]

  for (const [methode, pad] of BEHEERDERROUTES) {
    test(`${methode} ${pad} weigert een gewone gebruiker met 403`, async () => {
      const res = await backend.api(pad, { token: TOKEN_GEBRUIKER, methode, body: methode === 'PUT' ? { value: 'x' } : undefined })
      assert.equal(res.status, 403)
      assert.equal(res.json.error.code, 'FORBIDDEN')
    })
  }

  test('een beheerder mag het logboek lezen', async () => {
    const res = await backend.api('/api/audit-log', { token: TOKEN_ADMIN })
    assert.equal(res.status, 200)
    assert.deepEqual(Object.keys(res.json).sort(), ['items', 'page', 'pageSize', 'totaal'])
  })

  test('een niet-whitelisted config-sleutel is ook voor een beheerder dicht', async () => {
    const res = await backend.api('/api/config/MOTRAC_VERIFY_KEY', { token: TOKEN_ADMIN, methode: 'PUT', body: { value: 'x' } })
    assert.equal(res.status, 400)
  })
})
