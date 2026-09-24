// Sales offerte converter — Node.js/Express backend (API). Serveert alleen
// /api/* (op Postgres via db.js); de frontend (Vite-build) draait los, als
// eigen static_upload-applicatie op het IT Dashboard. Authenticatie: het
// Motrac-token van de SPA wordt server-side geverifieerd via het
// introspectie-endpoint van Motrac-beheer (POST /api/v1/<slug>/verify met
// X-Api-Key), zodat rollen hier — en niet alleen in de UI — worden afgedwongen.
//
// Basis: het generieke patroon van mit-salessupport (de norm-app) — zie
// CLAUDE.md, "Productie-hardening": opstartdiagnose, storingsmodus, CORS, rate
// limiter, bearer-auth-gate, requireAdmin, feedback-doorgifte, logboek.
//
// Domein: de offerte-conversie uit het oude repo `esign_motrac` (Java/Spring,
// hierheen geport, 2026-09-21). Een geüploade .docx wordt voorbewerkt,
// door LibreOffice naar PDF gerenderd en per checkbox voorzien van een
// verborgen DocuSign-anker in de tekstlaag (\cb_001\, \cb_002\, …). De
// hele keten staat in lib/conversie.js; hier alleen de routes eromheen
// (POST /api/conversies, GET /api/conversies/status, GET /api/conversies).
//
// Schema: migrations/0001_init.sql (config), 0002_audit_log.sql,
// 0003_conversies.sql (logboek van conversies). Zelf-migrerend
// bij opstarten (zie runMigrations onderaan, vóór app.listen) — het platform
// draait rechtstreeks `node server.js`, nooit een los migratie-commando.
import 'dotenv/config'
import { missingEnv } from './lib/startup-check.js'
import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { makeDb } from './db.js'
import { runMigrations } from './lib/migrate.js'
import { ConversieFout, MAX_DOCX_BYTES, converteerOfferte } from './lib/conversie.js'
import { ENGINE as DOCX_PDF_ENGINE, detecteerLibreOffice, engineStatus } from './lib/docxNaarPdf.js'
import { VEREISTE_LETTERTYPEN, beschikbareLettertypen, fontMappen, ontbrekendeVereisteLettertypen } from './lib/lettertypen.js'
import { beeldbankHeeft, isVeiligeBeeldnaam } from './lib/gekoppeldeAfbeeldingen.js'

// De slug die deze app in Motrac Toegangsbeheer heeft (toegekend 2026-09-22).
// Moet gelijk zijn aan DEFAULT_SLUG in frontend/src/lib/motracAuth.ts en aan
// de repository-variabele VITE_MOTRAC_AUTH_SLUG — die drie samen bepalen naar
// welke app de /verify-call gaat. Staan ze niet gelijk, dan logt de gebruiker
// wél in maar geeft elke /api/*-route een 401: het token is dan uitgegeven
// voor de ene app en hier gecontroleerd tegen de andere.
const APP_SLUG = 'esigntool'
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

// Base64 is 4/3 van de ruwe grootte; afgerond naar boven op hele MB's + 1 MB envelop.
const CONVERSIE_BODY_LIMIET = `${Math.ceil((MAX_DOCX_BYTES * 4) / 3 / (1024 * 1024)) + 1}mb`

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

// Diagnose van de conversie-engine, één keer per worker bij het opstarten en
// bewust niet afgewacht (geen top-level await, zie boven): /api/_health toont
// `null` tot de detectie klaar is. Een ontbrekend LibreOffice of ontbrekende
// DaxPro-bestanden zijn géén reden voor storingsmodus — de rest van de app
// werkt — maar horen wél in de log en op de statuskaart in de UI.
let libreOfficeDetectie = null
let lettertypeDetectie = null
if (DOCX_PDF_ENGINE === 'soffice') {
  detecteerLibreOffice().then((lo) => {
    libreOfficeDetectie = lo
    if (lo.gevonden) console.log(`LibreOffice gevonden: ${lo.commando} (${lo.versie})`)
    else console.warn('LibreOffice NIET gevonden — offerte-conversies geven een 503 tot het geïnstalleerd is (zie DEPLOY.md).')
  }, () => { libreOfficeDetectie = { gevonden: false } })
} else {
  libreOfficeDetectie = { gevonden: false, extern: true }
}
// De fontmappen van déze server (backend/fonts/, /uploads/fonts, FONTS_DIR)
// worden alleen bij de lokale soffice-engine in het LibreOffice-profiel
// gekopieerd. Bij Gotenberg gaat enkel de .docx naar de dienst en komen de
// lettertypen uit diens image; wat hier in de mappen staat zegt dan niets
// over de PDF. De statuskaart en /api/_health melden dat via `viaFontmappen`,
// zodat "DaxPro ontbreekt" niet naar de verkeerde map wijst (2026-09-22).
const FONTMAPPEN_GEBRUIKT = DOCX_PDF_ENGINE === 'soffice'
beschikbareLettertypen().then((bestanden) => {
  const ontbreekt = ontbrekendeVereisteLettertypen(bestanden)
  lettertypeDetectie = { aantal: bestanden.length, ontbreekt }
  console.log(`Lettertypen voor de PDF-render: ${bestanden.length} bestand(en) in ${fontMappen().join(', ')}`)
  if (!FONTMAPPEN_GEBRUIKT) {
    console.log(`Engine ${DOCX_PDF_ENGINE}: de lettertypen komen uit de externe LibreOffice-dienst, niet uit deze mappen (zie DEPLOY.md, route B).`)
  } else if (ontbreekt.length) {
    console.warn(`Vereiste lettertypen ontbreken (worden door LibreOffice vervangen): ${ontbreekt.join(', ')} — zie backend/fonts/README.md`)
  }
}, (e) => { lettertypeDetectie = { aantal: 0, ontbreekt: VEREISTE_LETTERTYPEN }; console.error('Lettertypen inlezen mislukt:', e) })

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
    // De render-engine van de offerte-conversie. Alleen booleans/aantallen —
    // dit endpoint is onbeveiligd. Zonder LibreOffice start de app gewoon
    // (storingsmodus is voor de basis, niet voor het domein), maar elke
    // conversie geeft dan een 503 — en dat is hier al vóór het inloggen te zien.
    conversie: {
      engine: DOCX_PDF_ENGINE,
      libreofficeGevonden: libreOfficeDetectie ? libreOfficeDetectie.gevonden : null,
      lettertypeBestanden: lettertypeDetectie ? lettertypeDetectie.aantal : null,
      vereisteLettertypenOntbreken: lettertypeDetectie ? lettertypeDetectie.ontbreekt : null,
      // false bij Gotenberg: de twee regels hierboven gaan dan over deze
      // server, niet over de dienst die rendert.
      viaFontmappen: FONTMAPPEN_GEBRUIKT,
    },
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
// De offerte-upload reist als base64 in een JSON-body (zodat de ene
// fetch-helper van de frontend, lib/api.ts, onaangepast blijft): 25 MB .docx
// wordt ~34 MB base64, plus een marge voor de envelop.
app.use('/api/conversies', express.json({ limit: CONVERSIE_BODY_LIMIET }))
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

// ---- Domein: offerte-conversie (DOCX → PDF met DocuSign-ankers) ---------------

// Status van de render-engine en de lettertypen, voor de statuskaart in de UI.
// Bearer (elke rol): de gebruiker moet vóór het uploaden kunnen zien dat de
// server het kan verwerken en of DaxPro aanwezig is.
app.get('/api/conversies/status', ah(async (req, res) => {
  const [engine, bestanden] = await Promise.all([engineStatus(), beschikbareLettertypen()])
  res.json({
    engine: engine.engine,
    beschikbaar: engine.beschikbaar,
    libreoffice: engine.libreoffice ? { versie: engine.libreoffice.versie } : null,
    lettertypen: {
      vereist: VEREISTE_LETTERTYPEN,
      ontbreekt: ontbrekendeVereisteLettertypen(bestanden),
      bestanden: bestanden.map((b) => ({ bestand: b.bestand, families: b.families })),
      // Alleen bij soffice gaan `bestanden` mee in de render; bij Gotenberg
      // is `ontbreekt` een uitspraak over deze server, niet over de PDF.
      viaFontmappen: FONTMAPPEN_GEBRUIKT,
    },
    maxDocxBytes: MAX_DOCX_BYTES,
  })
}))

// Welke gekoppelde afbeeldingen (E:\… in de .docx) heeft de beeldbank op de
// server? Body: { namen: string[] } — de app leest die namen zelf uit de .docx
// en vraagt de gebruiker alleen om de map als hier iets ontbreekt. Leest geen
// bestanden, alleen de index van de beeldbank; bearer (elke rol).
const MAX_AFBEELDINGEN = 50
app.post('/api/conversies/afbeeldingen', ah(async (req, res) => {
  const namen = req.body?.namen
  if (!Array.isArray(namen) || namen.length > MAX_AFBEELDINGEN || !namen.every(isVeiligeBeeldnaam)) {
    return sendErr(res, apiError('VALIDATION', `Geef maximaal ${MAX_AFBEELDINGEN} bestandsnamen van afbeeldingen, zonder pad.`, 400))
  }
  res.json(await beeldbankHeeft([...new Set(namen)]))
}))

/**
 * Meegestuurde afbeeldingen uit de body: [{ bestandsnaam, base64 }] → op
 * kleine-letternaam. Strikt: alleen een bestandsnaam (geen pad), strikte
 * base64, niet leeg. null = ongeldig.
 */
function leesMeegestuurdeAfbeeldingen(lijst) {
  if (lijst === undefined) return {}
  if (!Array.isArray(lijst) || lijst.length > MAX_AFBEELDINGEN) return null
  const uit = {}
  for (const a of lijst) {
    if (!isVeiligeBeeldnaam(a?.bestandsnaam) || typeof a?.base64 !== 'string' || !a.base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64)) return null
    uit[a.bestandsnaam.toLowerCase()] = new Uint8Array(Buffer.from(a.base64, 'base64'))
  }
  return uit
}

// De conversie zelf. Body: { bestandsnaam, docxBase64, afbeeldingen? }; antwoord: de PDF als
// base64 plus het aantal gevonden checkboxen en de lettertype-vergelijking.
// Elke uitkomst (ook een mislukking) komt in het conversies-logboek, zonder
// documentinhoud.
app.post('/api/conversies', ah(async (req, res) => {
  const bestandsnaam = typeof req.body?.bestandsnaam === 'string' ? req.body.bestandsnaam : ''
  const docxBase64 = typeof req.body?.docxBase64 === 'string' ? req.body.docxBase64 : ''
  const start = Date.now()

  let docx = null
  if (docxBase64) {
    // Strikt decoderen: Buffer.from negeert ongeldige tekens stilzwijgend, en
    // een half gedecodeerd bestand geeft verderop een onbegrijpelijke fout.
    if (/^[A-Za-z0-9+/]*={0,2}$/.test(docxBase64)) docx = new Uint8Array(Buffer.from(docxBase64, 'base64'))
  }

  // Gekoppelde afbeeldingen die de app uit de map van de gebruiker meestuurt
  // (zie POST /api/conversies/afbeeldingen); aanvulling op de beeldbank.
  const meegestuurdeAfbeeldingen = leesMeegestuurdeAfbeeldingen(req.body?.afbeeldingen)

  try {
    if (!docx) throw new ConversieFout('VALIDATION', 'Selecteer eerst een .docx-bestand.', { status: 400 })
    if (!meegestuurdeAfbeeldingen) throw new ConversieFout('VALIDATION', 'Een meegestuurde afbeelding is ongeldig (alleen een bestandsnaam en de inhoud, maximaal 50).', { status: 400 })
    const resultaat = await converteerOfferte({ bestandsnaam, docx, meegestuurdeAfbeeldingen })
    await registreerConversie(req, {
      bestandsnaam: resultaat.bestandsnaam.replace(/\.pdf$/i, '.docx'),
      status: 'geslaagd',
      aantalCheckboxen: resultaat.aantalCheckboxen,
      duurMs: resultaat.duurMs,
      engine: resultaat.engine,
      lettertypenVervangen: resultaat.lettertypen.vervangen,
    })
    res.json({
      bestandsnaam: resultaat.bestandsnaam,
      aantalCheckboxen: resultaat.aantalCheckboxen,
      pdfBase64: Buffer.from(resultaat.pdf).toString('base64'),
      lettertypen: resultaat.lettertypen,
      engine: resultaat.engine,
      duurMs: resultaat.duurMs,
      symbolenVervangen: resultaat.symbolenVervangen,
      ankersGeschat: resultaat.ankersGeschat,
      vormenVerwijderd: resultaat.vormenVerwijderd,
      // Tabelcel-alinea's waarvan opvulspaties zijn vervangen door rechts uitlijnen.
      opvulAlineas: resultaat.opvulAlineas,
      afbeeldingenIngesloten: resultaat.afbeeldingenIngesloten,
      ontbrekendeAfbeeldingen: resultaat.ontbrekendeAfbeeldingen,
      // Namen die de voorbewerking omzette omdat LibreOffice ze niet als familie
      // vindt (bv. DaxPro-Bold → DaxPro + vet), met het aantal opmaakblokken.
      lettertypenOmgezet: resultaat.lettertypenOmgezet,
    })
  } catch (e) {
    if (!(e instanceof ConversieFout)) throw e
    // Technische details (stderr van soffice) alleen in de log, nooit in het antwoord.
    console.warn(`Conversie mislukt (${e.code}): ${e.message}${e.detail ? `\n${e.detail}` : ''}`)
    if (e.code !== 'VALIDATION') {
      await registreerConversie(req, {
        bestandsnaam: bestandsnaam || '(onbekend)',
        status: 'mislukt',
        duurMs: Date.now() - start,
        engine: DOCX_PDF_ENGINE,
        foutcode: e.code,
        foutmelding: e.message,
      })
    }
    sendErr(res, apiError(e.code, e.message, e.status))
  }
}))

// Schrijft een regel in het conversies-logboek (migrations/0003). Zachtjes:
// de conversie zelf is al klaar (of al mislukt), een kapotte logregel mag de
// uitkomst niet veranderen.
async function registreerConversie(req, r) {
  try {
    await db
      .prepare('INSERT INTO conversies (actor_naam, actor_email, bestandsnaam, status, aantal_checkboxen, duur_ms, engine, lettertypen_vervangen, foutcode, foutmelding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(
        req.auth.user.naam, req.auth.user.email ?? null, r.bestandsnaam.slice(0, 500), r.status,
        r.aantalCheckboxen ?? null, r.duurMs ?? null, r.engine ?? null,
        JSON.stringify(r.lettertypenVervangen ?? []), r.foutcode ?? null, r.foutmelding?.slice(0, 1000) ?? null,
      )
      .run()
  } catch (e) {
    console.error('Conversie-logregel schrijven mislukt (conversie zelf is wél afgehandeld):', e)
  }
}

// Het conversies-logboek, server-side gepagineerd — beheerder-only, net als
// het audit-logboek: het bevat bestandsnamen en namen van collega's.
app.get('/api/conversies', requireAdmin, ah(async (req, res) => {
  const { page, pageSize } = paginering(req)
  const [{ totaal }] = (await db.prepare('SELECT count(*)::int AS totaal FROM conversies').all()).results
  const { results } = await db
    .prepare('SELECT id, aangemaakt_op, actor_naam, actor_email, bestandsnaam, status, aantal_checkboxen, duur_ms, engine, lettertypen_vervangen, foutcode, foutmelding FROM conversies ORDER BY aangemaakt_op DESC, id DESC LIMIT ? OFFSET ?')
    .bind(pageSize, (page - 1) * pageSize)
    .all()
  res.json({
    items: results.map((r) => ({
      id: r.id,
      aangemaaktOp: r.aangemaakt_op,
      actorNaam: r.actor_naam,
      actorEmail: r.actor_email,
      bestandsnaam: r.bestandsnaam,
      status: r.status,
      aantalCheckboxen: r.aantal_checkboxen,
      duurMs: r.duur_ms,
      engine: r.engine,
      lettertypenVervangen: (() => { try { return JSON.parse(r.lettertypen_vervangen) } catch { return [] } })(),
      foutcode: r.foutcode,
      foutmelding: r.foutmelding,
    })),
    page,
    pageSize,
    totaal,
  })
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
  // body-parser: JSON-body boven de limiet van het pad (bv. een .docx boven de
  // 25 MB). Een nette 413 in de fleet-envelop i.p.v. een 500 "er ging iets mis".
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'VALIDATION', message: 'Het bestand is te groot voor deze upload.' } })
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'De aanvraag bevat geen geldige JSON.' } })
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
    app.listen(port, host, () => console.log(`${APP_SLUG} backend luistert op :${port}`))
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
