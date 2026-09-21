// test/helpers/server.js — start de échte backend (node server.js) tegen een
// wegwerp-database en een nep-Motrac-beheer.
//
// Bewust het echte proces en niet een geïmporteerde express-app: de
// mount-volgorde uit server.js (trust proxy -> _health -> cors ->
// storingsmodus-gate -> rate limiter -> body-parsers -> bearer-auth) is
// functioneel en niet cosmetisch (zie CLAUDE.md, "Productie-hardening"), en
// die volgorde is alleen te controleren door de server te draaien zoals het
// platform hem draait.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { maakTestDatabase } from './postgres.js'
import { startBeheerStub, TOKEN_ADMIN, TOKEN_GEBRUIKER } from './beheerStub.js'

export { TOKEN_ADMIN, TOKEN_GEBRUIKER }

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

async function wachtOpFase(url, gewenst, timeoutMs = 30_000) {
  const eind = Date.now() + timeoutMs
  let laatste = null
  while (Date.now() < eind) {
    try {
      const res = await fetch(`${url}/api/_health`)
      laatste = await res.json()
      if (laatste.fase === gewenst) return laatste
      if (laatste.fase === 'mislukt' && gewenst !== 'mislukt') {
        throw new Error(`Backend startte in storingsmodus: ${laatste.fout}`)
      }
    } catch (err) {
      if (String(err.message).startsWith('Backend startte in storingsmodus')) throw err
    }
    await new Promise((klaar) => setTimeout(klaar, 150))
  }
  throw new Error(`Backend bereikte fase "${gewenst}" niet binnen ${timeoutMs}ms (laatst gezien: ${JSON.stringify(laatste)})`)
}

/**
 * Start de backend. `extraEnv` overschrijft/wist env-vars — `null` als waarde
 * verwijdert de variabele, zodat de storingsmodus-test een ontbrekende
 * DATABASE_URL kan nabootsen.
 */
export async function startBackend({ extraEnv = {}, verwachteFase = 'klaar' } = {}) {
  const database = await maakTestDatabase()
  const beheer = await startBeheerStub()

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: database.url,
    FRONTEND_ORIGIN: 'http://localhost:5173',
    MOTRAC_BEHEER_URL: beheer.url,
    MOTRAC_VERIFY_KEY: 'test-verify-key',
  }
  for (const [sleutel, waarde] of Object.entries(extraEnv)) {
    if (waarde === null) delete env[sleutel]
    else env[sleutel] = waarde
  }

  // Een vrije poort prikken via een luisterende socket die meteen weer
  // dichtgaat; server.js logt de gekozen poort niet terug.
  const net = await import('node:net')
  const poort = await new Promise((klaar) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => klaar(port))
    })
  })
  env.PORT = String(poort)

  const uitvoer = []
  const proces = spawn(process.execPath, ['server.js'], { cwd: backendDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  proces.stdout.on('data', (c) => uitvoer.push(String(c)))
  proces.stderr.on('data', (c) => uitvoer.push(String(c)))

  const url = `http://127.0.0.1:${poort}`
  try {
    await wachtOpFase(url, verwachteFase)
  } catch (err) {
    proces.kill('SIGKILL')
    await beheer.stop()
    await database.opruimen()
    throw new Error(`${err.message}\n--- serveruitvoer ---\n${uitvoer.join('')}`)
  }

  /** fetch met bearer-token en JSON-body, zoals de SPA hem doet. */
  async function api(pad, { token, methode = 'GET', body, headers = {} } = {}) {
    const res = await fetch(`${url}${pad}`, {
      method: methode,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Origin: 'http://localhost:5173',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const tekst = await res.text()
    let json = null
    try { json = tekst ? JSON.parse(tekst) : null } catch { /* geen JSON */ }
    return { status: res.status, json, tekst, headers: res.headers }
  }

  return {
    url,
    api,
    databaseUrl: database.url,
    uitvoer,
    beheerVerzoeken: beheer.verzoeken,
    async stop() {
      proces.kill('SIGKILL')
      await new Promise((klaar) => proces.on('exit', klaar))
      await beheer.stop()
      await database.opruimen()
    },
  }
}
