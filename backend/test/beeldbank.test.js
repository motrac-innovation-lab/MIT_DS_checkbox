// De beeldbank-opslag (lib/beeldbank.js) op een tijdelijke map: opslaan,
// vervangen met andere hoofdletters, inhoud die niet bij de extensie past,
// een schrijfmap zonder persistente opslag erboven, en de vergelijking voor
// een batch. Plus de routes over de echte server (beheerder-only, logboek).
import assert from 'node:assert/strict'
import test, { after, before, describe } from 'node:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  BeeldbankFout, inhoudPastBijExtensie, lijstBeeldbank, slaAfbeeldingenOp, vergelijkMetBeeldbank, verwijderAfbeelding,
} from '../lib/beeldbank.js'
import { zoekAfbeeldingen } from '../lib/gekoppeldeAfbeeldingen.js'
import { startBackend, TOKEN_ADMIN, TOKEN_GEBRUIKER } from './helpers/server.js'
import { slaOverZonderDb } from './helpers/postgres.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const b64 = (b) => Buffer.from(b).toString('base64')

let tmp
before(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), 'ds-beeldbank-unit-')) })
after(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }) })

async function nieuweMap(naam) {
  const map = path.join(tmp, naam)
  await mkdir(map)
  return map
}

test('de inhoud moet bij de extensie passen', () => {
  assert.equal(inhoudPastBijExtensie('a.png', PNG), true)
  assert.equal(inhoudPastBijExtensie('a.PNG', PNG), true)
  assert.equal(inhoudPastBijExtensie('a.jpg', JPG), true)
  assert.equal(inhoudPastBijExtensie('a.jpg', PNG), false)
  assert.equal(inhoudPastBijExtensie('a.png', Buffer.from('<html>')), false)
  assert.equal(inhoudPastBijExtensie('a.svg', Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')), true)
  assert.equal(inhoudPastBijExtensie('a.svg', Buffer.from('<html><svg/></html>')), false)
  assert.equal(inhoudPastBijExtensie('a.exe', PNG), false)
})

test('opslaan, en de conversie vindt het bestand daarna', async () => {
  const map = await nieuweMap('opslaan')
  const r = await slaAfbeeldingenOp([
    { bestandsnaam: 'truck.png', bytes: PNG },
    { bestandsnaam: '../weg.png', bytes: PNG },
    { bestandsnaam: 'leeg.png', bytes: new Uint8Array() },
    { bestandsnaam: 'nep.jpg', bytes: PNG },
  ], [map])
  assert.deepEqual(r.opgeslagen, [{ naam: 'truck.png', vervangen: false }])
  assert.deepEqual(r.geweigerd.map((g) => g.reden), ['naam', 'leeg', 'formaat'])
  assert.deepEqual(await readdir(map), ['truck.png'], 'geen tijdelijke bestanden achtergebleven')
  const zoek = await zoekAfbeeldingen(['TRUCK.png'], [map])
  assert.deepEqual(zoek.ontbrekend, [])
})

test('een bestaande naam met andere hoofdletters wordt vervangen, op zijn eigen plek', async () => {
  const map = await nieuweMap('vervangen')
  await mkdir(path.join(map, 'sub'))
  await writeFile(path.join(map, 'sub', 'Foto.PNG'), PNG)
  const nieuw = Buffer.concat([PNG, Buffer.from([0])])
  const r = await slaAfbeeldingenOp([{ bestandsnaam: 'foto.png', bytes: nieuw }], [map])
  assert.deepEqual(r.opgeslagen, [{ naam: 'foto.png', vervangen: true }])
  assert.deepEqual(await readdir(path.join(map, 'sub')), ['foto.png'], 'de oude kopie is weg')
  assert.equal((await readFile(path.join(map, 'sub', 'foto.png'))).length, nieuw.length)
})

test('een naam die in een alleen-lezen map staat wordt geweigerd', async () => {
  const schrijf = await nieuweMap('schrijf')
  const lees = await nieuweMap('lees')
  await writeFile(path.join(lees, 'ander.png'), PNG)
  const r = await slaAfbeeldingenOp([{ bestandsnaam: 'ANDER.png', bytes: PNG }], [schrijf, lees])
  assert.deepEqual(r.geweigerd, [{ naam: 'ANDER.png', reden: 'alleen_lezen' }])
  const lijst = await lijstBeeldbank({}, [schrijf, lees])
  assert.equal(lijst.items[0].alleenLezen, true)
  await assert.rejects(verwijderAfbeelding('ander.png', [schrijf, lees]), (e) => e instanceof BeeldbankFout && e.status === 403)
})

test('de schrijfmap wordt alleen aangemaakt als de map erboven bestaat', async () => {
  const onder = path.join(tmp, 'uploads-bestaat', 'afbeeldingen')
  await mkdir(path.dirname(onder))
  const r = await slaAfbeeldingenOp([{ bestandsnaam: 'a.png', bytes: PNG }], [onder])
  assert.equal(r.opgeslagen.length, 1)
  const zonder = path.join(tmp, 'geen-uploads', 'afbeeldingen')
  await assert.rejects(slaAfbeeldingenOp([{ bestandsnaam: 'a.png', bytes: PNG }], [zonder]), (e) => e.code === 'BEELDBANK_ONBESCHIKBAAR' && e.status === 503)
  const lijst = await lijstBeeldbank({}, [zonder])
  assert.deepEqual(lijst.opslag, { map: zonder, bestaat: false, kanAanmaken: false })
})

test('lijst: gesorteerd, gefilterd, gepagineerd; vergelijk op grootte', async () => {
  const map = await nieuweMap('lijst')
  for (const n of ['c.png', 'A.png', 'b-truck.png', 'notitie.txt']) await writeFile(path.join(map, n), PNG)
  const alles = await lijstBeeldbank({ pageSize: 2 }, [map])
  assert.equal(alles.totaal, 3, 'geen niet-beeldbestanden')
  assert.deepEqual(alles.items.map((i) => i.naam), ['A.png', 'b-truck.png'])
  assert.equal(alles.items[0].grootte, PNG.length)
  const gezocht = await lijstBeeldbank({ zoek: 'TRUCK' }, [map])
  assert.deepEqual(gezocht.items.map((i) => i.naam), ['b-truck.png'])
  const v = await vergelijkMetBeeldbank([
    { bestandsnaam: 'a.PNG', grootte: PNG.length },
    { bestandsnaam: 'c.png', grootte: 1 },
    { bestandsnaam: 'nieuw.png', grootte: 5 },
  ], [map])
  assert.deepEqual(v, { nieuw: ['nieuw.png'], gewijzigd: ['c.png'], gelijk: ['a.PNG'] })
})

describe('beeldbank-routes', { skip: slaOverZonderDb }, () => {
  let backend
  let map
  before(async () => {
    map = path.join(await nieuweMap('server'), 'afbeeldingen')
    backend = await startBackend({ extraEnv: { AFBEELDINGEN_DIR: map } })
  })
  after(async () => { if (backend) await backend.stop() })

  test('een beheerder uploadt, ziet, en verwijdert; het logboek houdt het bij', async () => {
    const up = await backend.api('/api/beeldbank', {
      token: TOKEN_ADMIN, methode: 'POST',
      body: { bestanden: [{ bestandsnaam: 'E50.png', base64: b64(PNG) }, { bestandsnaam: 'kapot.png', base64: b64(Buffer.from('x')) }] },
    })
    assert.equal(up.status, 200)
    assert.deepEqual(up.json.opgeslagen, [{ naam: 'E50.png', vervangen: false }])
    assert.deepEqual(up.json.geweigerd, [{ naam: 'kapot.png', reden: 'formaat' }])

    const lijst = await backend.api('/api/beeldbank?zoek=e50', { token: TOKEN_ADMIN })
    assert.equal(lijst.status, 200)
    assert.equal(lijst.json.totaal, 1)
    assert.equal(lijst.json.opslag.bestaat, true)

    // De conversie-kant ziet hem meteen.
    const heeft = await backend.api('/api/conversies/afbeeldingen', { token: TOKEN_GEBRUIKER, methode: 'POST', body: { namen: ['e50.PNG'] } })
    assert.deepEqual(heeft.json.gevonden, ['e50.PNG'])

    const v = await backend.api('/api/beeldbank/vergelijk', { token: TOKEN_ADMIN, methode: 'POST', body: { bestanden: [{ bestandsnaam: 'E50.png', grootte: PNG.length }] } })
    assert.deepEqual(v.json.gelijk, ['E50.png'])

    const weg = await backend.api('/api/beeldbank/e50.png', { token: TOKEN_ADMIN, methode: 'DELETE' })
    assert.equal(weg.status, 200)
    assert.equal(weg.json.verwijderd, 'E50.png')
    const nogEens = await backend.api('/api/beeldbank/e50.png', { token: TOKEN_ADMIN, methode: 'DELETE' })
    assert.equal(nogEens.status, 404)

    const log = await backend.api('/api/audit-log', { token: TOKEN_ADMIN })
    const acties = log.json.items.map((i) => i.actie)
    assert.ok(acties.includes('beeldbank.opgeslagen') && acties.includes('beeldbank.verwijderd'))
  })

  test('ongeldige verzoeken krijgen een 400', async () => {
    for (const body of [{}, { bestanden: [] }, { bestanden: [{ bestandsnaam: 'a.png', base64: '!!' }] }]) {
      const res = await backend.api('/api/beeldbank', { token: TOKEN_ADMIN, methode: 'POST', body })
      assert.equal(res.status, 400, JSON.stringify(body))
    }
    const v = await backend.api('/api/beeldbank/vergelijk', { token: TOKEN_ADMIN, methode: 'POST', body: { bestanden: [{ bestandsnaam: 'a/b.png', grootte: 1 }] } })
    assert.equal(v.status, 400)
  })
})
