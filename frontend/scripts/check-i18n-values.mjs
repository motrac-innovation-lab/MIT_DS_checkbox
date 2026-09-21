#!/usr/bin/env node
// check-i18n-values.mjs — vangt wat check-i18n-parity.mjs bewust laat liggen.
//
// Die eerste controleert of NL en EN dezelfde SLEUTELS hebben; hij zegt er zelf
// bij: "Not covered: value-level checks. A key whose value was never actually
// translated (still holding the source language's text) looks identical to a
// correct one here." Precies dat gat is in de praktijk het makkelijkst te
// maken: een nieuwe sleutel wordt in nl/ geschreven, naar en/ gekopieerd om de
// pariteitscheck te laten slagen, en daar blijft de Nederlandse tekst staan.
// De parity-check meldt niets en de Engelse gebruiker leest Nederlands.
//
// BEWUST EEN LOS SCRIPT en geen uitbreiding van check-i18n-parity.mjs: dat
// bestand is fleet-breed gedeeld ("copy this into your own project as
// scripts/check-i18n-parity.mjs") en hoort gelijk te blijven aan de kopieën in
// de andere repo's. Een uitbreiding daarin zou bij de eerstvolgende
// fleet-update stilletjes verdwijnen.
//
// Terechte gelijkenissen staan in scripts/i18n-gelijke-waarden.mjs, met de
// motivatie erbij. Deze check meldt ook een sleutel die daar nog in staat maar
// inmiddels wél vertaald is, zodat die lijst niet ongemerkt veroudert.
//
// Draaien:  node scripts/check-i18n-values.mjs
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { GELIJKE_WAARDEN } from './i18n-gelijke-waarden.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = process.env.I18N_LOCALES_DIR
  ? path.resolve(process.env.I18N_LOCALES_DIR)
  : path.resolve(HIER, '../src/i18n/locales')
const REFERENTIE = process.env.I18N_REFERENCE ?? 'nl'

/** Genest JSON -> platte sleutelpaden, arrays op index (zoals i18next ze adresseert). */
function plat(waarde, prefix, uit) {
  if (waarde !== null && typeof waarde === 'object') {
    const entries = Array.isArray(waarde)
      ? waarde.map((kind, i) => [String(i), kind])
      : Object.entries(waarde)
    for (const [sleutel, kind] of entries) plat(kind, prefix ? `${prefix}.${sleutel}` : sleutel, uit)
    return uit
  }
  uit.set(prefix, waarde)
  return uit
}

async function leesNamespace(taal, bestand) {
  const inhoud = await readFile(path.join(LOCALES_DIR, taal, bestand), 'utf8')
  return plat(JSON.parse(inhoud), '', new Map())
}

async function main() {
  const talen = (await readdir(LOCALES_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((t) => t !== REFERENTIE)

  const toegestaan = new Set(GELIJKE_WAARDEN)
  const gevonden = new Set()
  const onvertaald = []

  for (const taal of talen) {
    const bestanden = (await readdir(path.join(LOCALES_DIR, REFERENTIE))).filter((f) => f.endsWith('.json'))
    for (const bestand of bestanden) {
      const namespace = bestand.replace(/\.json$/, '')
      const referentie = await leesNamespace(REFERENTIE, bestand)
      let vertaling
      try {
        vertaling = await leesNamespace(taal, bestand)
      } catch {
        // Ontbrekende namespace is het werk van check-i18n-parity.mjs.
        continue
      }
      for (const [sleutel, waarde] of referentie) {
        if (typeof waarde !== 'string' || waarde.trim() === '') continue
        if (vertaling.get(sleutel) !== waarde) continue
        const volledig = `${namespace}:${sleutel}`
        gevonden.add(volledig)
        if (!toegestaan.has(volledig)) onvertaald.push({ taal, sleutel: volledig, waarde })
      }
    }
  }

  const verouderd = [...toegestaan].filter((s) => !gevonden.has(s))

  if (!onvertaald.length && !verouderd.length) {
    console.log(`i18n-waarden in orde: elke sleutel is vertaald of staat bewust in de uitzonderingenlijst (${toegestaan.size}).`)
    return
  }

  if (onvertaald.length) {
    console.error(`\n${onvertaald.length} sleutel(s) hebben in ${talen.join('/')} nog exact de ${REFERENTIE}-tekst:\n`)
    for (const item of onvertaald) {
      console.error(`  ${item.sleutel}\n    "${item.waarde}"`)
    }
    console.error(
      '\nVertaal ze, of zet ze in scripts/i18n-gelijke-waarden.mjs als de twee talen hier terecht\n' +
      'hetzelfde woord gebruiken (eigennaam, vakterm, een label uit een externe interface).',
    )
  }

  if (verouderd.length) {
    console.error(`\n${verouderd.length} sleutel(s) staan in i18n-gelijke-waarden.mjs maar zijn inmiddels wél vertaald`)
    console.error('(of bestaan niet meer). Haal ze uit die lijst:\n')
    for (const sleutel of verouderd) console.error(`  ${sleutel}`)
  }

  console.error('')
  process.exit(1)
}

main().catch((err) => {
  console.error(`check-i18n-values.mjs mislukt: ${err.message}`)
  process.exit(1)
})
