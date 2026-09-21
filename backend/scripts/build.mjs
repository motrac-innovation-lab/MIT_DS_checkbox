#!/usr/bin/env node
// scripts/build.mjs — stelt precies de boom samen die naar het serverpark gaat.
//
// WAAROM DIT BESTAAT
//
// dashboard-deploy.mjs uploadt ALLES onder `buildDir`. Die bestandswandeling
// slaat exact twee namen over — "node_modules" en ".git" — en leest
// `.gitignore` niet. Dotfiles zijn niet uitgezonderd, dus een `.env` in de map
// waar `buildDir` naar wijst wordt gewoon meegeüpload en belandt op ELKE
// replica, leesbaar voor iedereen met dashboard-toegang tot deze applicatie.
// In deze backend staat in die `.env` het productie-DATABASE_URL (inclusief
// wachtwoord), de MOTRAC_VERIFY_KEY en straks het persoonlijke
// DASHBOARD_DEPLOY_TOKEN. Dat mag het serverpark dus nooit bereiken.
//
// Daarom wordt de broncode hier nooit rechtstreeks geüpload. Dit script
// kopieert alleen de bestanden die daadwerkelijk moeten draaien naar `dist/`,
// en `.dashboarddeploy.json` wijst `buildDir` naar `dist`. Een secret dat
// ergens in `backend/` rondslingert kan het serverpark niet bereiken, simpelweg
// omdat niets het kopieert.
//
// De gegenereerde dist/package.json heeft bewust GEEN "build"-script: de deploy
// draait op de doelserver `npm install --no-audit --no-fund && npm run build
// --if-present`, en dat moet daar een no-op zijn — de boom is hier al gebouwd.
//
// Afhankelijkheidsvrije ESM, alleen Node-ingebouwde modules.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectRoot, 'dist')

// Alleen dit belandt in dist/. Bewust een expliciete lijst en nooit een glob:
// een nieuw bestand moet je hier aanzetten, zodat er niets per ongeluk meelift.
//
// Alle routes zitten in server.js zelf (geen routes/-map), en er is geen aparte
// db-instance.js —
// server.js doet zelf `await makeDb(...)`. Wat er wél moet zijn:
//   server.js       — de hele API, het startpunt (`node server.js`)
//   db.js           — D1-compat-shim over Postgres, geïmporteerd door server.js
//   lib/            — startup-check.js (env-validatie) + migrate.js (runner)
//   migrations/     — *.sql, tijdens het draaien ingelezen door lib/migrate.js;
//                     zonder deze map migreert de server zichzelf niet en blijft
//                     de database leeg
//
// Wat hier NIET in staat en waarom:
//   .env / .env.example  — echte credentials, zie de uitleg hierboven
//   node_modules/        — de doelserver draait zelf `npm install`
//   package-lock.json    — hoort bij de volledige package.json (incl. devDeps);
//                          de dist/package.json hieronder is uitgekleed
//   scripts/             — lokale CLI-hulpjes (migrate.mjs en dit script zelf);
//                          server.js migreert zichzelf al bij het opstarten,
//                          vóór app.listen()
const COPY_ENTRIES = [
  { from: 'server.js', kind: 'file' },
  { from: 'db.js', kind: 'file' },
  { from: 'lib', kind: 'dir' },
  { from: 'migrations', kind: 'dir' },
]

async function main() {
  await fs.rm(distDir, { recursive: true, force: true })
  await fs.mkdir(distDir, { recursive: true })

  const written = []

  for (const entry of COPY_ENTRIES) {
    const src = path.join(projectRoot, entry.from)
    const dest = path.join(distDir, entry.from)

    let stat
    try {
      stat = await fs.stat(src)
    } catch {
      throw new Error(`Kan niet bouwen: ${entry.from} bestaat niet in ${projectRoot}.`)
    }
    if (entry.kind === 'dir' && !stat.isDirectory()) {
      throw new Error(`Kan niet bouwen: ${entry.from} zou een map moeten zijn.`)
    }
    if (entry.kind === 'file' && !stat.isFile()) {
      throw new Error(`Kan niet bouwen: ${entry.from} zou een bestand moeten zijn.`)
    }

    await fs.cp(src, dest, { recursive: entry.kind === 'dir' })
    written.push(entry.kind === 'dir' ? `${entry.from}/` : entry.from)
  }

  // De runtime-package.json wordt afgeleid van de echte, zodat de
  // dependency-versies nooit uit elkaar kunnen lopen. Alles wat hier niet
  // expliciet staat valt weg: geen devDependencies om op de doelserver te
  // installeren, en geen andere scripts dan `start`.
  const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'))

  const runtimePkg = {
    name: pkg.name,
    version: pkg.version,
    private: pkg.private,
    type: pkg.type,
    engines: pkg.engines,
    // Hier expliciet `node server.js` en niet blind het `start`-script uit de
    // bron overnemen: dat is nu toevallig hetzelfde, maar zodra daar ooit een
    // migratiestap voor komt te staan (zoals bij Motrac-beheer) zou die op de
    // doelserver breken — `scripts/` gaat namelijk niet mee, en server.js
    // migreert zichzelf al vóór app.listen().
    scripts: { start: 'node server.js' },
    dependencies: pkg.dependencies,
  }
  for (const [k, v] of Object.entries(runtimePkg)) {
    if (v === undefined) delete runtimePkg[k]
  }

  await fs.writeFile(path.join(distDir, 'package.json'), `${JSON.stringify(runtimePkg, null, 2)}\n`, 'utf8')
  written.push('package.json')

  // Laatste vangnet: als er ondanks de allowlist tóch een .env in dist/ staat,
  // stop dan hard in plaats van hem te laten uploaden.
  const strays = []
  async function scan(dir) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await scan(p)
      else if (/^\.env(\..+)?$/.test(e.name)) strays.push(path.relative(distDir, p))
    }
  }
  await scan(distDir)
  if (strays.length) {
    throw new Error(`.env-bestand(en) in dist/ aangetroffen, upload afgebroken: ${strays.join(', ')}`)
  }

  console.log(`[build] ${path.relative(projectRoot, distDir) || 'dist'}/ geschreven:`)
  for (const name of written) console.log(`[build]   ${name}`)
  console.log('[build] verder is er niets gekopieerd — een .env in backend/ kan het serverpark niet bereiken.')
}

main().catch((err) => {
  console.error(`[build] mislukt: ${err.message}`)
  process.exit(1)
})
