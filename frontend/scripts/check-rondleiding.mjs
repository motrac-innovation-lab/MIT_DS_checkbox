#!/usr/bin/env node
// Poort op de rondleiding (src/rondleiding/), meegenomen in `npm run build`
// naast de i18n-checks en motrac-ui-check.
//
// WAAROM dit bestaat. Een rondleiding is de enige werkinstructie ín de app, en
// ze loopt stilletjes achter zodra iemand een scherm verbouwt: het anker
// verdwijnt en de stap wijst nergens meer naar, of een stap krijgt een id
// zonder tekst en de gebruiker leest de kale sleutel `stap.xyz.titel`. In
// mit-salessupport — de eerste app van de fleet met een rondleiding — is dat
// twee keer gebeurd vóórdat daar een controle omheen kwam. Een comment is geen
// poort; dit wel.
//
// Wat hier mechanisch te controleren valt:
//   1. elke stap heeft in BEIDE talen een titel en een tekst;
//   2. er staat geen tekst van een stap die niet meer bestaat;
//   3. elk `[data-rondleiding="…"]`-anker uit stappen.ts komt echt in de app voor;
//   4. elk `data-rondleiding`-attribuut in de app wordt door een stap gebruikt;
//   5. elke `route` van een stap is een bestaand tabpad uit App.tsx — wijst er
//      één naar een onbekende tab, dan stuurt de catch-all-route daar door naar
//      /converteren en draait de rondleiding rond in plaats van vast te lopen,
//      wat veel later pas opvalt.
// Of wat een stap ZEGT nog klopt, blijft mensenwerk; dat kan geen script lezen.
//
// Dependency-vrij, net als de twee i18n-checks. Draaien:
//   node scripts/check-rondleiding.mjs

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const WORTEL = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lees = (relatief) => readFileSync(join(WORTEL, relatief), 'utf8')

/** Comments eruit; die bevatten voorbeelden die geen echt anker zijn. */
const zonderComments = (tekst) => tekst
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/[^\n]*$/gm, '')

// ---- stappen.ts inlezen -----------------------------------------------------
// De deploy-job draait Node 20 en die kan geen TypeScript importeren, dus we
// lezen het bestand als TEKST en zetten het STAPPEN-literal om naar JSON. Dat
// stelt één eis aan stappen.ts, en die staat daar ook als comment: elke stap is
// één plat object-literal met enkele aanhalingstekens. Wijkt er iets af, dan
// gooit JSON.parse of valt de telling hieronder om — nooit een stap die
// stilletjes buiten de controle valt.
function leesStappen() {
  const bron = zonderComments(lees('src/rondleiding/stappen.ts'))
  // Vanaf het `=` zoeken en niet vanaf de naam: het type-annotatie
  // `: RondleidingStap[]` staat ertussen en die blokhaken zijn de array niet.
  const naam = bron.indexOf('export const STAPPEN')
  const isGelijk = naam < 0 ? -1 : bron.indexOf('=', naam)
  const begin = isGelijk < 0 ? -1 : bron.indexOf('[', isGelijk)
  if (begin < 0) throw new Error('kan `export const STAPPEN ... = [` niet vinden in src/rondleiding/stappen.ts')

  // Haakjes tellen tot de array dicht is; aanhalingstekens overslaan zodat een
  // `]` in een selector (`[data-rondleiding="x"]`) niet meetelt.
  let diepte = 0
  let eind = -1
  let aanhaling = null
  for (let i = begin; i < bron.length; i += 1) {
    const c = bron[i]
    if (aanhaling) {
      if (c === '\\') i += 1
      else if (c === aanhaling) aanhaling = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') aanhaling = c
    else if (c === '[') diepte += 1
    else if (c === ']') {
      diepte -= 1
      if (diepte === 0) { eind = i; break }
    }
  }
  if (eind < 0) throw new Error('de STAPPEN-array in src/rondleiding/stappen.ts is niet gesloten')

  const body = bron.slice(begin, eind + 1)
  const json = body
    // 'tekst' -> "tekst", met de dubbele quotes ín de selectors netjes geëscaped.
    .replace(/'((?:[^'\\]|\\.)*)'/g, (_, inhoud) => JSON.stringify(inhoud.replace(/\\'/g, "'")))
    // kale sleutels -> "sleutel"
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    // afsluitende komma's
    .replace(/,(\s*[}\]])/g, '$1')

  let stappen
  try {
    stappen = JSON.parse(json)
  } catch (e) {
    throw new Error(
      `kan de STAPPEN-lijst niet lezen (${e.message}).\n`
      + '  Elke stap hoort één plat object-literal met enkele aanhalingstekens te zijn — zie de toelichting in src/rondleiding/stappen.ts.',
    )
  }
  // Telling als vangnet: een stap die door een afwijkend formaat niet als eigen
  // object uit de parse komt, zou anders ongemerkt overgeslagen worden.
  const verwacht = (body.match(/\bid\s*:/g) ?? []).length
  if (stappen.length !== verwacht) {
    throw new Error(`gelezen ${stappen.length} stappen, maar het bestand noemt ${verwacht} keer een \`id:\` — het formaat wijkt af.`)
  }
  return stappen
}

let STAPPEN
try {
  STAPPEN = leesStappen()
} catch (e) {
  console.error(`check-rondleiding: ${e.message}`)
  process.exit(1)
}

const nl = JSON.parse(lees('src/i18n/locales/nl/rondleiding.json'))
const en = JSON.parse(lees('src/i18n/locales/en/rondleiding.json'))

/** Alle .tsx onder src/, zodat de ankers tegen de echte schermen gelegd worden. */
function bronBestanden(map) {
  return readdirSync(join(WORTEL, map), { withFileTypes: true }).flatMap((item) => {
    const relatief = `${map}/${item.name}`
    if (item.isDirectory()) return bronBestanden(relatief)
    return item.name.endsWith('.tsx') ? [relatief] : []
  })
}

const bronZonderComments = zonderComments(bronBestanden('src').map(lees).join('\n'))

const fouten = []

// ---- 1 + 2: teksten ---------------------------------------------------------
for (const stap of STAPPEN) {
  for (const [taal, teksten] of [['nl', nl], ['en', en]]) {
    const tekst = teksten.stap?.[stap.id]
    if (!tekst) {
      fouten.push(`stap "${stap.id}" mist ${taal}/rondleiding.json > stap.${stap.id}`)
      continue
    }
    if (!tekst.titel) fouten.push(`stap "${stap.id}" mist een titel in ${taal}`)
    if (!tekst.tekst) fouten.push(`stap "${stap.id}" mist een tekst in ${taal}`)
  }
}
const stapIds = new Set(STAPPEN.map((s) => s.id))
for (const id of Object.keys(nl.stap ?? {})) {
  if (!stapIds.has(id)) fouten.push(`nl/rondleiding.json heeft tekst voor "${id}", maar die stap staat niet in stappen.ts`)
}

// ---- 3 + 4: ankers ----------------------------------------------------------
/** De ankernaam uit een selector `[data-rondleiding="x"]`, of null. */
const ankerNaam = (selector) => selector.match(/^\[data-rondleiding="([^"]+)"\]$/)?.[1] ?? null

/**
 * De ankernamen die de app echt zet. Twee schrijfwijzen, allebei toegestaan:
 *   data-rondleiding="naam"
 *   data-rondleiding={voorwaarde ? 'naam-a' : 'naam-b'}
 * Die tweede is er voor een scherm waar het anker van de gegevens afhangt; uit
 * zo'n expressie halen we élke stringliteral.
 *
 * Bewust GEEN losse "staat de naam ergens in de bron"-terugval: die liet een
 * hernoemd anker erdoor, omdat zo'n woord ook als tabsleutel in App.tsx staat.
 */
function ankersInBron(tekst) {
  const gevonden = new Set()
  for (const m of tekst.matchAll(/data-rondleiding="([^"]+)"/g)) gevonden.add(m[1])
  for (const m of tekst.matchAll(/data-rondleiding=\{([^}]*)\}/g)) {
    for (const lit of m[1].matchAll(/'([^']+)'|"([^"]+)"/g)) gevonden.add(lit[1] ?? lit[2])
  }
  return gevonden
}

const gezet = ankersInBron(bronZonderComments)
const gebruikt = new Set()
for (const stap of STAPPEN) {
  if (!stap.anker) continue
  const naam = ankerNaam(stap.anker)
  if (naam === null) {
    // Geen data-anker (een `a[href="…"]`-selector of een eigen klasse). Dat
    // mag, maar alleen als de stap optioneel is: de zijbalklink bestaat op een
    // smal scherm niet, en een klasse kan bij een verbouwing verdwijnen.
    if (!stap.optioneel) {
      fouten.push(`stap "${stap.id}" gebruikt selector \`${stap.anker}\` zonder data-rondleiding; markeer hem als \`optioneel\` of geef het element een data-rondleiding-attribuut.`)
    }
    continue
  }
  gebruikt.add(naam)
  if (!gezet.has(naam)) {
    fouten.push(`stap "${stap.id}" wijst naar anker "${naam}", maar geen enkel scherm zet dat attribuut.`)
  }
}
for (const naam of gezet) {
  if (!gebruikt.has(naam)) fouten.push(`anker "${naam}" staat in de app, maar geen enkele stap gebruikt hem.`)
}

// ---- 5: routes --------------------------------------------------------------
const app = lees('src/App.tsx')
const tabPaden = new Set([...app.matchAll(/\bto: '(\/[a-z-]+)'/g)].map((m) => m[1]))
for (const stap of STAPPEN) {
  if (!tabPaden.has(stap.route)) {
    fouten.push(`stap "${stap.id}" hoort op route "${stap.route}", maar dat is geen tabpad in App.tsx (bekend: ${[...tabPaden].join(', ')}).`)
  }
}

// ---- rapport ----------------------------------------------------------------
if (fouten.length === 0) {
  console.log(`check-rondleiding: geen bevindingen (${STAPPEN.length} stappen, ${gebruikt.size} ankers).`)
  process.exit(0)
}
console.error('check-rondleiding: de rondleiding loopt achter op de app.\n')
for (const f of fouten) console.error(`  - ${f}`)
console.error(`\n${fouten.length} bevinding(en). Zie src/rondleiding/stappen.ts.`)
process.exit(1)
