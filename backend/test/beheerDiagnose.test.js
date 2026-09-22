// De diagnose van GET /api/_health/beheer. Deze test bestaat om één concrete
// verwarring te voorkomen: op 2026-09-22 stond MOTRAC_BEHEER_URL op de
// WEBPAGINA van Motrac-beheer in plaats van op de API. Die host antwoordt op
// elk pad met 200 en HTML, en de oude diagnose meldde daardoor "koppeling
// werkt" terwijl de hele app 401's gaf.
import assert from 'node:assert/strict'
import test from 'node:test'
import { beoordeelBeheerAntwoord } from '../lib/beheerDiagnose.js'

test('een HTML-pagina met status 200 is GEEN werkende koppeling', () => {
  const r = beoordeelBeheerAntwoord({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html>\n<html lang="nl"><head><meta http-equiv="Content-Security-Policy"',
  })
  assert.equal(r.bruikbaar, false)
  assert.match(r.oordeel, /NIET naar de API/)
  assert.match(r.oordeel, /webpagina/)
})

test('JSON zonder content-type telt ook als JSON', () => {
  const r = beoordeelBeheerAntwoord({ status: 200, contentType: null, body: '{"active":false}' })
  assert.equal(r.bruikbaar, true)
})

test('401 met INVALID_API_KEY betekent: juiste URL, verkeerde sleutel', () => {
  const r = beoordeelBeheerAntwoord({
    status: 401,
    contentType: 'application/json; charset=utf-8',
    body: '{"error":{"code":"INVALID_API_KEY","message":"Ongeldige of ontbrekende API-key"}}',
  })
  assert.equal(r.bruikbaar, true, 'de URL klopt — alleen de sleutel niet')
  assert.match(r.oordeel, /MOTRAC_VERIFY_KEY/)
})

test('404 met JSON wijst naar een verkeerde slug', () => {
  const r = beoordeelBeheerAntwoord({ status: 404, contentType: 'application/json', body: '{"error":{"code":"NOT_FOUND"}}' })
  assert.equal(r.bruikbaar, false)
  assert.match(r.oordeel, /APP_SLUG/)
})

test('een geslaagde JSON-controle is een werkende koppeling', () => {
  const r = beoordeelBeheerAntwoord({ status: 200, contentType: 'application/json', body: '{"active":false}' })
  assert.equal(r.bruikbaar, true)
  assert.match(r.oordeel, /koppeling werkt/)
})

test('een serverfout is geen werkende koppeling', () => {
  const r = beoordeelBeheerAntwoord({ status: 503, contentType: 'application/json', body: '{"error":{}}' })
  assert.equal(r.bruikbaar, false)
  assert.match(r.oordeel, /503/)
})
