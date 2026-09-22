// test/helpers/beheerStub.js — een nep-Motrac-beheer voor de routetests.
//
// De backend verifieert élk /api/*-verzoek server-side bij Motrac-beheer
// (POST /api/v1/<slug>/verify). Zonder stub is er dus geen enkele
// route te testen. Deze stub praat exact het antwoord terug dat
// `authenticate()` verwacht: { active, user: { ..., rol } }.
import http from 'node:http'

/** Tokens die de stub kent; alles daarbuiten is `active: false`. */
export const TOKEN_GEBRUIKER = 'test-token-gebruiker'
export const TOKEN_ADMIN = 'test-token-admin'

const GEBRUIKERS = {
  [TOKEN_GEBRUIKER]: { id: '1', naam: 'Test Gebruiker', email: 'gebruiker@motrac.nl', rol: 'gebruiker', emplid: 'TG01' },
  [TOKEN_ADMIN]: { id: '2', naam: 'Test Beheerder', email: 'beheerder@motrac.nl', rol: 'admin', emplid: 'TB01' },
}

export async function startBeheerStub() {
  const verzoeken = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      verzoeken.push({ url: req.url, apiKey: req.headers['x-api-key'] })
      if (!req.url.endsWith('/verify')) {
        res.writeHead(404).end('{}')
        return
      }
      let token = null
      try { token = JSON.parse(body || '{}').token } catch { /* ongeldige body -> geen token */ }
      const user = GEBRUIKERS[token]
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(user ? { active: true, user } : { active: false }))
    })
  })
  await new Promise((klaar) => server.listen(0, '127.0.0.1', klaar))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}`,
    verzoeken,
    async stop() { await new Promise((klaar) => server.close(klaar)) },
  }
}
