// Het deploy-vangnet dat er niet was: .github/workflows/deploy.yml draaide
// voor de backend alleen `npm ci && npm run build`, en scripts/build.mjs
// KOPIEERT alleen — het importeert server.js nooit. Een syntaxfout in
// server.js ging dus groen door CI heen en kwam als crashlus/502 in productie
// terecht, precies het scenario waar de storingsmodus voor gebouwd is.
//
// Deze test doet twee dingen die build.mjs niet doet:
//   1. `node --check` over elk bestand dat meegaat naar het serverpark;
//   2. de module-graaf vanaf dist/server.js aflopen, zodat een nieuw
//      lib-bestand dat vergeten is in COPY_ENTRIES hier faalt in plaats van
//      pas op de productieserver ("Cannot find module").
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const uitvoeren = promisify(execFile)
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function alleJsBestanden(dir) {
  const gevonden = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) gevonden.push(...(await alleJsBestanden(p)))
    else if (/\.(js|mjs)$/.test(entry.name)) gevonden.push(p)
  }
  return gevonden
}

test('elk backend-bestand is syntactisch geldig', async () => {
  const bestanden = await alleJsBestanden(backendDir)
  assert.ok(bestanden.length > 5, 'verwacht meer dan een handvol bestanden')
  for (const bestand of bestanden) {
    await uitvoeren(process.execPath, ['--check', bestand])
  }
})

const RELATIEVE_IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g

async function relatieveImports(bestand) {
  const inhoud = await fs.readFile(bestand, 'utf8')
  const paden = new Set()
  for (const match of inhoud.matchAll(RELATIEVE_IMPORT)) {
    paden.add(match[1] ?? match[2])
  }
  return [...paden]
}

test('dist/ bevat de volledige module-graaf van server.js', async () => {
  await uitvoeren(process.execPath, ['scripts/build.mjs'], { cwd: backendDir })
  const distDir = path.join(backendDir, 'dist')

  const tebezoeken = [path.join(distDir, 'server.js')]
  const gezien = new Set()
  while (tebezoeken.length) {
    const bestand = tebezoeken.pop()
    if (gezien.has(bestand)) continue
    gezien.add(bestand)
    // Bestaat het bestand? Zo niet, dan mist het in COPY_ENTRIES.
    await assert.doesNotReject(
      fs.access(bestand),
      `${path.relative(distDir, bestand)} ontbreekt in dist/ — voeg het toe aan COPY_ENTRIES in scripts/build.mjs`,
    )
    for (const imp of await relatieveImports(bestand)) {
      tebezoeken.push(path.resolve(path.dirname(bestand), imp))
    }
  }

  assert.ok(gezien.size >= 4, `verwacht server.js, db.js en de twee lib-bestanden in de graaf, kreeg ${gezien.size}`)
  // migrations/ wordt tijdens het draaien ingelezen (geen import), dus die map
  // wordt hier apart gecontroleerd — zonder migraties blijft de database leeg.
  const migraties = await fs.readdir(path.join(distDir, 'migrations'))
  const bron = await fs.readdir(path.join(backendDir, 'migrations'))
  assert.deepEqual(migraties.sort(), bron.sort(), 'dist/migrations/ wijkt af van backend/migrations/')
})

test('dist/ bevat geen .env-bestand en geen node_modules', async () => {
  const distDir = path.join(backendDir, 'dist')
  const strays = []
  async function scan(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        assert.notEqual(e.name, 'node_modules', 'node_modules hoort niet in dist/')
        await scan(path.join(dir, e.name))
      } else if (/^\.env(\..+)?$/.test(e.name)) strays.push(e.name)
    }
  }
  await scan(distDir)
  assert.deepEqual(strays, [])
})
