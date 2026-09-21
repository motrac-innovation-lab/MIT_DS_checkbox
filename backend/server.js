// Sales offerte converter — Node.js/Express backend (API). Serveert alleen
// /api/* (op Postgres via db.js); de frontend (Vite-build) draait los, als
// eigen static_upload-applicatie op het IT Dashboard. Authenticatie: het
// Motrac-token van de SPA wordt server-side geverifieerd via het
// introspectie-endpoint van Motrac-beheer (POST /api/v1/<slug>/verify met
// X-Api-Key), zodat rollen hier — en niet alleen in de UI — worden afgedwongen.
//
// Vers fleet-scaffold, overgenomen uit het generieke patroon van
// mit-salessupport (de norm-app) met alle domeinlogica weggelaten. Wat hier
// staat is de basis die elke fleet-backend deelt (zie CLAUDE.md,
// "Productie-hardening"): opstartdiagnose, storingsmodus, CORS, rate limiter,
// bearer-auth-gate, requireAdmin, feedback-doorgifte, logboek. De eerste
// domeinroute komt in een volgende stap.
//
// Schema: migrations/0001_init.sql (config), 0002_audit_log.sql. Zelf-migrerend
// bij opstarten (zie runMigrations onderaan, vóór app.listen) — het platform
// draait rechtstreeks `node server.js`, nooit een los migratie-commando.
import 'dotenv/config'
import { missingEnv } from './lib/startup-check.js'
import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { makeDb } from './db.js'
import { runMigrations } from './lib/migrate.js'

// PLACEHOLDER tot de app in Motrac Toegangsbeheer geregistreerd is. Moet
// gelijk zijn aan DEFAULT_SLUG in frontend/src/lib/motracAuth.ts en aan de
// repository-variabele VITE_MOTRAC_AUTH_SLUG.
const APP_SLUG = 'mit-ds-checkbox'
const VERIFY_CACHE_TTL_MS = 60_000

// GEEN top-level `await` in dit bestand — een harde eis van het deploy-
// platform. Cluster mode staat aan (een worker per CPU-core) en de wrapper
// die dat regelt is CommonJS: die doet `require()` op het entry-bestand. Node
// kan een ES-module via `require()` laden, maar alleen zonder top-level
// `await` in de module-graaf. Anders sterft elke worker direct met
// ERR_REQUIRE_ASYNC_MODULE en herstart de wrapper hem zonder backoff — een
// eindeloze crashlus achter een 502. Dat gebeurde op 2026-08-12 live bij
// Motrac-beheer, op ditzelfde platform.
//
// Daarom wordt makeDb() hier wél gestart maar niet afgewacht: `dbReady` voor
// de opstartketen onderaan, en `db` als dunne doorgeef-versie die pas bij
// gebruik (binnen een request, als de verbinding allang staat) naar de echte
// instantie wijst. Ook bewust GEEN `throw` op moduleniveau bij een
// ontbrekende DATABASE_URL: een afgewezen promise, die de opstartketen netjes
// afvangt en op /api/_health toont.
const dbReady = process.env.DATABASE_URL
  ? makeDb(process.env.DATABASE_URL)
  : Promise.reject(new Error('DATABASE_URL ontbreekt — zet hem in het Environment-paneel van de applicatie (lokaal: backend/.env, zie .env.example)'))

let realDb = null
// De afwijzing wordt hier bewust genegeerd: de opstartketen onderaan hangt aan
// dezelfde promise en meldt de fout daar één keer.
dbReady.then((instance) => { realDb = instance }, () => {})

function readyDb() {
  if (!realDb) {
    throw new Error('Databaseverbinding is nog niet klaar — dit hoort binnen een request niet te kunnen, want de poort gaat pas open nadat dbReady is opgelost.')
  }
  return realDb
}

const db = {
  prepare: (query) => readyDb().prepare(query),
  batch: (stmts) => readyDb().batch(stmts),
  // Getter, geen momentopname: db.js wisselt de onderliggende client om bij een
  // failover, dus dit moet elke keer de actuele client teruggeven.
  get sql() { return readyDb().sql },
}

const apiError = (code, message, status) => ({ status, body: { error: { code, message } } })
const sendErr = (res, err) => res.status(err.status).json(err.body)

// Een schrijfactie kan sneuvelen op een moment waarop niet vast te stellen is
// of hij al was uitgevoerd (failover midden in de bewerking, zie db.js). Zo'n
// bewerking wordt bewust NIET automatisch herhaald, maar de gebruiker moet
// wél horen dát de uitkomst onbekend is.
const IN_DOUBT_CODE = 'DB_STATE_UNKNOWN'
const IN_DOUBT_MESSAGE =
  'De database wisselde tijdens deze bewerking van server. Het is niet vast te stellen of uw wijziging is doorgevoerd — controleer dat eerst en probeer het pas daarna opnieuw.'

// ---- Auth: token-introspectie bij Motrac-beheer --------------------------

// Korte cache per proces zodat niet elk request een extra HTTP-call naar
// Motrac-beheer kost; 60s is ruim binnen de sessieduur en beperkt de
// vertraging waarmee een ingetrokken token hier nog even doorwerkt.
const verifyCache = new Map()

// Zonder deze sweep blijft een token dat maar één keer gebruikt wordt voor de
// rest van het proces in de Map hangen. .unref() zodat deze timer het
// afsluiten van het proces niet blokkeert.
setInterval(() => {
  const now = Date.now()
  for (const [token, entry] of verifyCache) {
    if (entry.until <= now) verifyCache.delete(token)
  }
}, VERIFY_CACHE_TTL_MS).unref()

// De verify-key komt bij voorkeur uit de env-var MOTRAC_VERIFY_KEY; anders
// uit de config-tabel in de eigen database. Per proces gecachet.
let verifyKeyPromise
function getVerifyKey() {
  if (process.env.MOTRAC_VERIFY_KEY) return Promise.resolve(process.env.MOTRAC_VERIFY_KEY)
  return (verifyKeyPromise ??= db
    .prepare("SELECT value FROM config WHERE key = 'MOTRAC_VERIFY_KEY'")
    .first()
    .then((row) => row?.value ?? '')
    .catch((e) => { verifyKeyPromise = undefined; throw e }))
}

const extractBearer = (req) => (req.get('Authorization') || '').match(/^Bearer\s+(\S+)$/)?.[1]

async function authenticate(bearer) {
  if (!bearer) return null

  const cached = verifyCache.get(bearer)
  if (cached && cached.until > Date.now()) return cached.auth

  verifyCache.delete(bearer)

  let payload
  try {
    const res = await fetch(`${process.env.MOTRAC_BEHEER_URL}/api/v1/${APP_SLUG}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': await getVerifyKey() },
      body: JSON.stringify({ token: bearer }),
    })
    if (!res.ok) return null
    payload = await res.json()
  } catch {
    return null
  }
  if (!payload?.active || !payload.user) return null

  const auth = {
    user: payload.user,
    // De twee standaard app_rollen van Motrac-beheer: gebruiker/admin. Fijner
    // onderscheid komt hier pas zodra een feature het nodig heeft.
    isAdmin: (payload.user.rol || '').trim().toLowerCase() === 'admin',
  }
  verifyCache.set(bearer, { auth, until: Date.now() + VERIFY_CACHE_TTL_MS })
  return auth
}

// ---- Logboek: overzicht van beheer-handelingen (zie migrations/0002) -----

/** Schrijft een logregel voor een geslaagde, muterende handeling van req.auth.user. */
async function logAction(req, actie, omschrijving) {
  await db
    .prepare('INSERT INTO audit_log (actor_naam, actor_email, actie, omschrijving) VALUES (?, ?, ?, ?)')
    .bind(req.auth.user.naam, req.auth.user.email ?? null, actie, omschrijving)
    .run()
}

// Gebruik deze variant overal waar de eigenlijke mutatie al onherroepelijk
// gecommit is vóórdat er gelogd wordt: een mislukte logregel mag een al
// geslaagde actie nooit alsnog als mislukt aan de gebruiker tonen.
async function logActionZachtjes(req, actie, omschrijving) {
  try {
    await logAction(req, actie, omschrijving)
  } catch (e) {
    console.error('Logregel schrijven mislukt (actie is wél uitgevoerd):', e)
  }
}

// Paginering uit de querystring: page minstens 1, pageSize tussen 1 en 200.
function paginering(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 50))
  return { page, pageSize }
}

async function queryAuditLog({ page, pageSize }) {
  const [{ totaal }] = (await db.prepare('SELECT count(*)::int AS totaal FROM audit_log').all()).results
  const { results } = await db
    .prepare('SELECT id, aangemaakt_op, actor_naam, actor_email, actie, omschrijving FROM audit_log ORDER BY aangemaakt_op DESC, id DESC LIMIT ? OFFSET ?')
    .bind(pageSize, (page - 1) * pageSize)
    .all()
  return {
    items: results.map((r) => ({
      id: r.id,
      aangemaaktOp: r.aangemaakt_op,
      actorNaam: r.actor_naam,
      actorEmail: r.actor_email,
      actie: r.actie,
      omschrijving: r.omschrijving,
    })),
    page,
    pageSize,
    totaal,
  }
}

// ---- Bootstrap-dataset (GET /api/data) -------------------------------------

// Alleen deze config-sleutels zijn via PUT /api/config/:key bewerkbaar én
// komen in GET /api/data terug. De config-tabel bevat ook MOTRAC_VERIFY_KEY,
// en die hoort nooit bij een gebruiker te belanden — bewust fail-closed:
// een nieuwe sleutel die de UI mag zien, moet hier expliciet bij.
const CONFIG_WHITELIST = []

async function loadAppData() {
  const config = {}
  if (CONFIG_WHITELIST.length) {
    const placeholders = CONFIG_WHITELIST.map(() => '?').join(', ')
    const { results } = await db
      .prepare(`SELECT key, value FROM config WHERE key IN (${placeholders})`)
      .bind(...CONFIG_WHITELIST)
      .all()
    for (const r of results) config[r.key] = r.value
  }
  return { config }
}

// ---- Express-app en routing ------------------------------------------------

const app = express()

// Eén reverse proxy vóór deze backend (standaard bij dit platform) — nodig
// zodat express-rate-limit op het echte client-IP (X-Forwarded-For) sleutelt.
app.set('trust proxy', 1)

// Achtervang (niet de eigenlijke fix — dat is de ah()-wrapper op elke
// async-route hieronder): logt in plaats van het proces stil te laten
// crashen op een onafgehandelde promise-rejection.
process.on('unhandledRejection', (reason) => {
  console.error('Onafgehandelde promise-rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('Onafgehandelde exception:', err)
})

// ---- Opstartdiagnose -------------------------------------------------------
// Op dit platform is een mislukte start onzichtbaar van buitenaf: het proces
// stopt, de cluster-wrapper herstart het zonder backoff, en de reverse proxy
// geeft alleen een kale 502/503 zonder CORS-headers — wat de browser als
// CORS-fout toont. Daarom stopt deze backend niet bij een mislukte start,
// maar opent hij de poort in storingsmodus en is de oorzaak hier opvraagbaar.
const startupState = {
  fase: missingEnv.length ? 'mislukt' : 'bezig',
  fout: missingEnv.length ? `Ontbrekende omgevingsvariabelen: ${missingEnv.join(', ')}` : null,
}

// Vóór de rate limiter, de auth-middleware en de 404-afhandeling gemount,
// zodat dit endpoint ook in storingsmodus altijd antwoordt.
app.get('/api/_health', (req, res) => {
  res.status(startupState.fout ? 503 : 200).json({
    fase: startupState.fase,
    fout: startupState.fout,
    // Alleen óf ze gezet zijn, nooit de waarde.
    envAanwezig: Object.fromEntries(
      ['DATABASE_URL', 'FRONTEND_ORIGIN', 'MOTRAC_BEHEER_URL', 'MOTRAC_VERIFY_KEY']
        .map((k) => [k, Boolean(process.env[k]?.trim())])
    ),
    // NOOIT de ruwe waarde teruggeven: dit endpoint is onbeveiligd. Alleen de
    // host, en alleen als het echt een geldige http(s)-URL is.
    beheerUrlVorm: (() => {
      const raw = process.env.MOTRAC_BEHEER_URL || ''
      try {
        const u = new URL(raw)
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.host : 'onverwacht protocol'
      } catch { return 'GEEN GELDIGE URL — waarschijnlijk staat hier een verkeerde waarde in' }
    })(),
  })
})

// Losse diagnose van de koppeling met Motrac-beheer: elke mislukte
// tokencontrole geeft in authenticate() gewoon `null` en dus een 401, niet te
// onderscheiden van een verlopen sessie. Deze route doet dezelfde aanroep met
// een opzettelijk ongeldig token en laat zien wat er werkelijk terugkomt —
// nooit de sleutel zelf. Zonder ah(): die is hieronder nog niet gedefinieerd
// (const), en de handler vangt zelf alles af.
app.get('/api/_health/beheer', async (req, res) => {
  const raw = process.env.MOTRAC_BEHEER_URL || ''
  let host
  try { host = new URL(raw).host } catch { host = null }
  if (!host) { res.status(502).json({ oordeel: 'MOTRAC_BEHEER_URL is geen geldige URL — controleer het Environment-paneel', beheerUrlVorm: 'ongeldig' }); return }
  const url = `${raw}/api/v1/${APP_SLUG}/verify`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 5000)
  try {
    const key = await getVerifyKey()
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
      body: JSON.stringify({ token: 'diagnose-ongeldig-token' }),
      signal: ac.signal,
    })
    const body = (await r.text()).slice(0, 200)
    res.json({
      beheerHost: host,
      sleutelGevonden: Boolean(key),
      status: r.status,
      antwoord: body,
      oordeel: r.status === 200 ? 'koppeling werkt (401 komt dan door het token zelf)' : 'koppeling faalt — dit verklaart de 401 op alles',
    })
  } catch (e) {
    res.status(502).json({ beheerHost: host, oordeel: 'koppeling onbereikbaar — dit verklaart de 401 op alles', fout: String(e?.message || e) })
  } finally {
    clearTimeout(timer)
  }
})

// Vóór de rate limiter gemount: anders krijgt een 429 geen CORS-headers mee
// en ziet de browser een onduidelijke CORS-fout i.p.v. een 429.
app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',').map((o) => o.trim()) ?? [] }))

// Storingsmodus-gate: is het opstarten mislukt, dan geeft élk ander endpoint
// een duidelijke 503 met de (opgeschoonde) oorzaak. Hier gemount (ná cors,
// vóór alle routes) zodat de 503 zijn CORS-headers houdt.
app.use((req, res, next) => {
  if (startupState.fase !== 'mislukt') return next()
  res.status(503).json({
    error: { code: 'STARTUP_FAILED', message: `Backend kon niet opstarten: ${startupState.fout}` },
  })
})

// Begrenst het aantal /api-verzoeken per IP zodat een ongeauthenticeerde
// aanvrager niet met een stortvloed aan foute bearer-tokens de verify-call
// naar Motrac-beheer — een gedeelde centrale dienst — kan belasten. Vóór de
// body-parsers, anders wordt er ongelimiteerd 12mb geparsed vóór elke check.
const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use('/api', apiLimiter)

// Feedback heeft een eigen, ruimere limiet: screenshots reizen als base64 mee
// in de JSON-body. Moet vóór de generieke express.json() staan — body-parser
// slaat een al geparste body over, dus wie het eerst parseert bepaalt de
// limiet voor dat pad.
app.use('/api/feedback', express.json({ limit: '12mb' }))
// Klein en generiek: voorkomt dat een ongeauthenticeerde aanvrager tot 12MB
// laat parsen vóórdat de auth-check hieronder ooit draait.
app.use(express.json({ limit: '256kb' }))

// Vangt afgewezen promises van async route-handlers en stuurt ze naar de
// centrale error-middleware onderaan.
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next)

// ---- Bearer-auth-gate: alles onder /api vanaf hier vereist een geldig token --
app.use('/api', ah(async (req, res, next) => {
  const auth = await authenticate(extractBearer(req))
  if (!auth) return sendErr(res, apiError('UNAUTHENTICATED', 'Niet ingelogd of sessie verlopen.', 401))
  req.auth = auth
  next()
}))

function requireAdmin(req, res, next) {
  if (!req.auth.isAdmin) return sendErr(res, apiError('FORBIDDEN', 'Alleen beheerders mogen deze actie uitvoeren.', 403))
  next()
}

// Bootstrap-endpoint: de frontend haalt dit op na het inloggen zodra er een
// datalaag is (zie CLAUDE.md, "Volgende stap").
app.get('/api/data', ah(async (req, res) => {
  res.json(await loadAppData())
}))

// Doorgifte van de gedeelde FeedbackWidget naar Motrac-beheer, pas ná de
// server-side auth hierboven; de eigen backend zet er alleen userLabel bij.
app.post('/api/feedback', ah(async (req, res) => {
  const userLabel = `${req.auth.user.naam} (${req.auth.isAdmin ? 'admin' : req.auth.user.rol ?? 'gebruiker'})`
  const payload = {
    type: req.body.type,
    message: req.body.message,
    pageContext: req.body.pageContext,
    screenshotBase64: req.body.screenshotBase64,
    // Verrijkte velden van de FeedbackWidget — optioneel, Motrac-beheer
    // valideert ze zelf.
    screenshotMime: req.body.screenshotMime,
    thumbBase64: req.body.thumbBase64,
    viewportBreedte: req.body.viewportBreedte,
    viewportHoogte: req.body.viewportHoogte,
    thema: req.body.thema,
    userAgent: req.body.userAgent,
    annotatie: req.body.annotatie,
    userLabel,
  }
  const beheerRes = await fetch(`${process.env.MOTRAC_BEHEER_URL}/api/v1/${APP_SLUG}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': await getVerifyKey() },
    body: JSON.stringify(payload),
  })
  const data = await beheerRes.json().catch(() => ({}))
  res.status(beheerRes.status).json(data)
}))

// Alleen-lezen logboek van beheer-handelingen — beheerder-only.
app.get('/api/audit-log', requireAdmin, ah(async (req, res) => {
  res.json(await queryAuditLog(paginering(req)))
}))

// Bewerken van whitelisted config-sleutels — beheerder-only. Zolang
// CONFIG_WHITELIST leeg is, is elke sleutel een 400.
app.put('/api/config/:key', requireAdmin, ah(async (req, res) => {
  const { key } = req.params
  if (!CONFIG_WHITELIST.includes(key)) return sendErr(res, apiError('VALIDATION', 'Onbekende of niet-bewerkbare instelling.', 400))
  const value = typeof req.body?.value === 'string' ? req.body.value : null
  if (value === null) return sendErr(res, apiError('VALIDATION', "Veld 'value' (tekst) is verplicht.", 400))
  await db
    .prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value')
    .bind(key, value)
    .run()
  await logActionZachtjes(req, 'config.gewijzigd', `Instelling ${key} gewijzigd.`)
  res.json({ key, value })
}))

// Onbekend /api/*-endpoint (geen van de routes hierboven matchte).
app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Onbekend endpoint.' } })
})

// Centrale foutafhandeling: zelfde envelop/statuscodes als de rest van de fleet.
app.use((err, req, res, next) => {
  console.error('API-fout:', err)
  // Is er al (deels) een antwoord de deur uit, dan kan er geen status/JSON
  // meer bovenop — doorgeven aan Express' eigen finalhandler.
  if (res.headersSent) { next(err); return }
  // Schrijfactie waarvan onbekend is of hij al is doorgevoerd (zie db.js):
  // status 500 en niet 503 — 503 nodigt uit tot automatisch opnieuw proberen,
  // en dat is hier juist de gevaarlijke actie.
  if (err?.failoverInDoubt) {
    return res.status(500).json({ error: { code: IN_DOUBT_CODE, message: IN_DOUBT_MESSAGE } })
  }
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Er ging iets mis; probeer het later opnieuw.' } })
})

// Het platform injecteert PORT; lokaal de vaste fleet-poort van deze app.
// Altijd 0.0.0.0: Caddy op de loadbalancer belt de private mesh-IP van de
// server, en een bind op 127.0.0.1 maakt de app onbereikbaar.
const port = Number(process.env.PORT ?? 8798)
const host = '0.0.0.0'

// Migreren vóór het openen van de poort. `dbReady` eerst: de verbinding werd
// bewust niet op moduleniveau ge-await (zie de uitleg bovenaan). Ontbreken er
// verplichte env-vars, dan wordt er niet eens een verbinding geprobeerd.
;(missingEnv.length
  ? Promise.reject(new Error(`Ontbrekende omgevingsvariabelen: ${missingEnv.join(', ')}`))
  : dbReady.then((instance) => runMigrations(instance.sql)))
  .then(() => {
    startupState.fase = 'klaar'
    app.listen(port, host, () => console.log(`mit-ds-checkbox backend luistert op :${port}`))
  })
  .catch((e) => {
    // Opstarten mislukt: tóch de poort openen, zodat /api/_health de oorzaak
    // kan vertellen in plaats van een onzichtbare crashlus achter een 502.
    // Bewust geen process.exit(1): het platform herstart een gestopt proces
    // meteen en zonder backoff.
    startupState.fase = 'mislukt'
    startupState.fout = String(e?.message || e).replace(/postgres(ql)?:\/\/[^\s]*/gi, '<connectiestring verborgen>')
    console.error('Opstarten mislukt — server draait in storingsmodus:', e)
    app.listen(port, host, () => console.log(`Storingsmodus: luistert op :${port}, zie /api/_health`))
  })
