// db.js — D1-compatible facade over PostgreSQL, using the `postgres` npm
// package (postgres.js), for a plain Node.js/Express backend (no Cloudflare
// involved — just a normal TCP connection via DATABASE_URL). Goal: existing
// call sites written as `env.DB.prepare(sql).bind(...args).all()/.first()/
// .run()` keep working almost unchanged — only `env.DB` becomes `db` from
// this module, and SQL text gets the dialect fixes below (datetime('now')
// -> now(), etc).
//
// Supports both SQLite placeholder styles: anonymous `?` (sequential) and
// explicit `?N` (1-based) — both are rewritten to Postgres `$N`.
import postgres from 'postgres'

function toPgParams(sqlText) {
  let auto = 0
  return sqlText.replace(/\?(\d+)?/g, (_, n) => `$${n ? Number(n) : ++auto}`)
}

// postgres.js 3.4.x heeft een bug bij een multi-host DATABASE_URL (voor
// failover) waarvan de hosts de TCP-verbinding snel wéigeren (i.p.v. stil
// hangen): de interne `retries`-teller wordt tijdens de allereerste
// connectiepoging nooit opgehoogd, waardoor de query nooit reject() krijgt en
// oneindig blijft hangen — `connect_timeout` helpt hier niet tegen, die vangt
// alléén een stille hang op. Zonder deze wrapper hangt zo'n aanvraag tot de
// reverse proxy zelf (leeg, zonder CORS-headers) een 502 teruggeeft, wat de
// browser als "Failed to fetch" toont i.p.v. een duidelijke serverfout.
// De timeout krijgt een herkenbare `.code` zodat withFailoverRetry() hieronder
// onderscheid kan maken tussen "dit kan een failover zijn, probeer opnieuw"
// (een hangende query tijdens een primary-promotie ziet er hetzelfde uit als
// deze timeout) en een gewone, blijvende querybug.
function withTimeout(promise, ms = 15000) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Database time-out na ${ms}ms`)
      err.code = 'QUERY_TIMEOUT'
      reject(err)
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// TLS naar Postgres: op dit serverpark staat de database op het private
// WireGuard-mesh (10.99.0.x) en biedt hij géén TLS aan — het transport is al
// versleuteld op netwerkniveau. Het platform-sjabloon zet dan ook helemaal geen
// ssl-optie.
//
// Hier stond eerder `ssl: 'require'`, bedoeld om te voorkomen dat de verbinding
// stil zou terugvallen op plaintext. Op dit platform betekent dat echter dat de
// TLS-handshake nooit slaagt: elke host geeft "Client network socket
// disconnected before secure TLS connection was established",
// resolveWritableConnectionString() vindt daardoor geen enkele schrijfbare host
// en de app start niet meer op. Dat heeft op 2026-08-12 de productie-app van
// Motrac-beheer platgelegd; deze backend had exact dezelfde fout en zou bij de
// eerstvolgende deploy identiek zijn omgevallen.
//
// Daarom standaard uit, met een ontsnappingsluik voor het geval de database
// ooit wél TLS gaat aanbieden: zet dan `PGSSLMODE=require` in het
// Environment-paneel van de applicatie.
const PG_SSL = process.env.PGSSLMODE === 'require' ? 'require' : false

// postgres.js parseert `target_session_attrs` uit een multi-host DATABASE_URL
// wel als optie (sql.options.target_session_attrs), maar DWINGT hem niet af:
// in productie verbond hij gewoon met een van de twee hosts zonder te
// controleren of die schrijfbaar is, en trof een read-only standby — elke
// CREATE TABLE/INSERT/UPDATE faalde met "cannot execute ... in a read-only
// transaction" (Postgres-foutcode 25006). Daarom lossen we de schrijfbare
// host hier zelf op: elke host uit de lijst wordt apart (als gewone
// single-host-connectiestring — die gedroegen zich al correct, in
// tegenstelling tot postgres.js' eigen multi-host-logica) geprobeerd,
// met `SELECT pg_is_in_recovery()` om te bepalen of het een standby (true) of
// de primary (false) is; de eerste die aan de gevraagde
// `target_session_attrs`-eis voldoet wordt de echte connectie.
//
// Dit gebeurt niet alleen één keer bij het opstarten, maar ook opnieuw
// tijdens het draaien zodra een query een fout geeft die op een failover kan
// wijzen (zie classifyDbError/withFailoverRetry in makeDb() hieronder) —
// zonder die her-resolutie bleef de app na een Postgres-failover permanent
// tegen de nu gedegradeerde/read-only oude primary aanpraten totdat iemand
// hem handmatig herstartte.
async function resolveWritableConnectionString(connectionString) {
  const m = connectionString.match(/^(postgres(?:ql)?:\/\/[^/@]*@)([^/]+)(\/.*)$/)
  if (!m) return connectionString // onverwachte vorm (of maar één host) — ongewijzigd doorgeven
  const [, prefix, hostList, suffix] = m
  const hosts = hostList.split(',')
  if (hosts.length === 1) return connectionString // niets op te lossen

  const wantsReadWrite = /target_session_attrs=read-write/i.test(suffix)
  const cleanSuffix = suffix.replace(/([?&])target_session_attrs=[^&]*&?/i, '$1').replace(/[?&]$/, '')
  let lastErr = new Error('Geen enkele host in DATABASE_URL is bereikbaar')
  for (const host of hosts) {
    const candidate = `${prefix}${host}${cleanSuffix}`
    const probe = postgres(candidate, { prepare: false, ssl: PG_SSL, connect_timeout: 10, max: 1, onnotice: () => {} })
    try {
      const [{ in_recovery }] = await withTimeout(probe.unsafe('SELECT pg_is_in_recovery() AS in_recovery'), 12000)
      if (!wantsReadWrite || !in_recovery) {
        await probe.end({ timeout: 1 })
        return candidate
      }
      console.warn(`Postgres-host ${host} is een read-only standby, wordt overgeslagen (target_session_attrs=read-write).`)
      await probe.end({ timeout: 1 })
    } catch (e) {
      lastErr = e
      await probe.end({ timeout: 1 }).catch(() => {})
    }
  }
  throw new Error(`Geen schrijfbare Postgres-host gevonden in DATABASE_URL: ${lastErr.message}`)
}

// Foutcodes die op een failover kunnen wijzen, gesplitst naar het ENIGE
// onderscheid dat er voor herhalen toe doet: is de statement gegarandeerd
// NIET uitgevoerd, of kan hij al wél zijn uitgevoerd terwijl alleen het
// antwoord verloren ging?
//
// Blind herhalen mag alleen in het eerste geval. Dat onderscheid is niet
// theoretisch: zonder deze splitsing wordt een INSERT die de primary al had
// gecommit (maar waarvan het antwoord onderweg sneuvelde) doodleuk een tweede
// keer uitgevoerd — een dubbele stickeruitgifte, dubbele voorraadmutatie of
// dubbele logregel, met een keurige 200 terug naar de gebruiker.
//
// Geverifieerd tegen de broncode van postgres.js 3.4.x in node_modules:
//   - CONNECT_TIMEOUT   (src/connection.js, connectTimedOut) — time-out tijdens
//     het OPZETTEN van de verbinding; er is nooit iets verstuurd.
//   - CONNECTION_ENDED  (src/index.js, handler → `if (ending)`) — de query is
//     uit postgres.js' eigen wachtrij geweigerd, nooit de socket op gegaan.
//   - CONNECTION_CLOSED (src/connection.js, `(query || sent.length) && error(...)`)
//     — geldt juist voor queries die AL verstuurd waren; die zijn dus in doubt.
//   - CONNECTION_DESTROYED — idem, in-flight query op een vernietigde socket.
// 25006 is Postgres' eigen read_only_sql_transaction: de server weigerde de
// statement vóór uitvoering, dus die is gegarandeerd niet toegepast — precies
// de fout die een gedegradeerde primary geeft, en veilig te herhalen.
const NEVER_EXECUTED_CODES = new Set([
  '25006',
  'ECONNREFUSED',
  'CONNECT_TIMEOUT',
  'CONNECTION_ENDED',
])

// Kan al uitgevoerd zijn: het antwoord ging verloren, niet per se de statement.
// QUERY_TIMEOUT is hier het scherpste geval: withTimeout() hierboven verliest
// alleen een Promise.race — de query blijft gewoon dóórdraaien op de server.
// Herhalen na een QUERY_TIMEOUT is dus geen risico op dubbele uitvoering maar
// een vrijwel zekerheid.
const IN_DOUBT_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'QUERY_TIMEOUT',
])

function classifyDbError(err) {
  const code = err && err.code
  if (NEVER_EXECUTED_CODES.has(code)) return 'never-executed'
  if (IN_DOUBT_CODES.has(code)) return 'in-doubt'
  return 'other'
}

// Alleen een statement die niets wijzigt mag blind herhaald worden na een
// in-doubt-fout. Bewust conservatief: alles wat niet overduidelijk een pure
// leesquery is, geldt als schrijfactie. Een false negative (een SELECT die
// hier als schrijfactie wordt gezien) kost hooguit een gemiste retry; een
// false positive zou een dubbele schrijfactie opleveren.
function isReadOnlyStatement(sqlText) {
  const t = String(sqlText).replace(/^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, '')
  if (!/^(?:select|with|show|explain)\b/i.test(t)) return false
  // Een WITH-CTE mag zelf data wijzigen, en SELECT nextval()/setval() heeft
  // een blijvend neveneffect — die vallen dus af, net als een SELECT ... FOR
  // UPDATE (die locks neemt).
  if (/\b(?:insert|update|delete|merge|truncate|create|drop|alter|grant|revoke|nextval|setval)\b/i.test(t)) return false
  return true
}

// One shared connection pool for the whole process — created once at module
// load, reused by every request, en tijdens het draaien vervangen als een
// failover wordt gedetecteerd (zie withFailoverRetry hieronder). `DATABASE_URL`
// is a normal Postgres connection string, e.g. `postgres://user:pass@db-host:5432/dbname`.
// Zie PG_SSL hierboven voor waarom TLS hier standaard uit staat (de database
// zit op het private WireGuard-mesh en biedt geen TLS aan; `ssl: 'require'`
// legde daarmee de hele opstart plat).
// `connect_timeout` vangt een stille hang bij het opzetten van de verbinding
// op (zie withTimeout hierboven voor de aanvullende, niet-stille variant).
// `onnotice: () => {}` onderdrukt Postgres NOTICE-meldingen (bv. "relation X
// already exists, skipping" bij elke zelf-migratie-herstart) die anders bij
// elke boot naar console.log gespamd worden.
export async function makeDb(connectionString) {
  const sqlOptions = { prepare: false, ssl: PG_SSL, connect_timeout: 10, onnotice: () => {} }

  let currentConnectionString = await resolveWritableConnectionString(connectionString)
  let sql = postgres(currentConnectionString, sqlOptions)

  // Een failover laat niet één query sneuvelen maar ALLE queries die op dat
  // moment lopen. Zonder deze single-flight zou elke gefaalde query zijn eigen
  // her-resolutie starten, en die opent een aparte probe-connectie PER HOST —
  // tientallen gelijktijdige verbindingen naar een cluster dat op dat moment
  // juist het kwetsbaarst is. Alle gelijktijdige aanroepen delen daarom
  // dezelfde lopende poging.
  let reconnectInFlight = null

  // Wordt aangeroepen ná een query-fout die op een failover kan wijzen: zoekt
  // opnieuw de schrijfbare host op over de VOLLEDIGE oorspronkelijke
  // multi-host DATABASE_URL (niet alleen de huidige host) en wisselt, als die
  // afwijkt van de huidige connectie, de live `sql`-client om. Geeft terug of
  // er daadwerkelijk gewisseld is.
  function reconnectIfWritableHostChanged() {
    if (reconnectInFlight) return reconnectInFlight
    reconnectInFlight = (async () => {
      const resolved = await resolveWritableConnectionString(connectionString)
      if (resolved === currentConnectionString) return false
      const newSql = postgres(resolved, sqlOptions)
      const oldSql = sql
      sql = newSql
      currentConnectionString = resolved
      console.warn('Schrijfbare Postgres-host gewisseld (vermoedelijke failover), oude connectie wordt op de achtergrond gesloten.')
      oldSql.end({ timeout: 1 }).catch(() => {})
      return true
    })().finally(() => { reconnectInFlight = null })
    return reconnectInFlight
  }

  // Voert `fn(sql)` uit tegen de huidige connectie. Bij een fout die op een
  // failover kan wijzen wordt ALTIJD opnieuw de schrijfbare host gezocht (zodat
  // een volgend verzoek hoe dan ook op de juiste host uitkomt) — maar de
  // aanroep zelf wordt alleen herhaald als dat aantoonbaar veilig is:
  //
  //   * 'never-executed' → altijd herhalen; de statement is gegarandeerd niet
  //     toegepast, dus herhalen kan niets dubbel doen.
  //   * 'in-doubt' + leesquery → herhalen; een SELECT twee keer uitvoeren is
  //     onschadelijk.
  //   * 'in-doubt' + schrijfactie → NIET herhalen, maar doorgooien. Liever een
  //     zichtbare fout dan een stilzwijgend dubbel uitgevoerde INSERT/UPDATE.
  //     De fout krijgt `failoverInDoubt = true` mee zodat een route desgewenst
  //     kan melden dat de status onbekend is in plaats van "mislukt".
  //
  // Dit is wat postgres.js zelf had moeten doen op basis van
  // target_session_attrs=read-write, maar niet doet (zie boven) — zonder deze
  // wrapper blijft de app na een failover permanent tegen de oude, nu
  // read-only primary aanpraten totdat iemand hem handmatig herstart.
  async function withFailoverRetry(fn, { readOnly = false } = {}) {
    try {
      return await fn(sql)
    } catch (err) {
      const kind = classifyDbError(err)
      if (kind === 'other') throw err
      console.warn(`Database-fout die op een failover kan wijzen (${err.code}, ${kind}), her-resolve schrijfbare host...`)
      try {
        await reconnectIfWritableHostChanged()
      } catch (reErr) {
        console.warn(`Her-resolutie van schrijfbare host mislukt: ${reErr.message}`)
      }
      if (kind === 'never-executed' || readOnly) return await fn(sql)
      err.failoverInDoubt = true
      console.warn('Schrijfactie niet automatisch herhaald: onbekend of hij al was uitgevoerd (dubbele uitvoering zou erger zijn dan een foutmelding).')
      throw err
    }
  }

  function buildMeta(rows) {
    const meta = {}
    if (Array.isArray(rows) && rows.length && rows[0] && 'id' in rows[0]) meta.last_row_id = rows[0].id
    if (typeof rows.count === 'number') meta.changes = rows.count
    return meta
  }

  function prepare(query) {
    const pgQuery = toPgParams(query)
    // Eén keer per prepare() bepaald i.p.v. per uitvoering: bepaalt of deze
    // statement na een in-doubt-fout blind herhaald mag worden (zie
    // withFailoverRetry).
    const readOnly = isReadOnlyStatement(query)
    // `_exec(client)` runs against whichever client is passed in — the
    // current live `sql` for direct calls (die tijdens het draaien kan
    // wisselen, zie reconnectIfWritableHostChanged), or a `tx` handed in by
    // batch() below — so batched and non-batched statements share one code
    // path.
    function withArgs(args) {
      const _exec = (client) => withTimeout(client.unsafe(pgQuery, args))
      return {
        all: async () => ({ results: await withFailoverRetry(_exec, { readOnly }) }),
        first: async () => {
          const rows = await withFailoverRetry(_exec, { readOnly })
          return rows[0] ?? null
        },
        run: async () => {
          const rows = await withFailoverRetry(_exec, { readOnly })
          return { success: true, meta: buildMeta(rows), results: rows }
        },
        _exec,
      }
    }
    return { bind: (...args) => withArgs(args), ...withArgs([]) }
  }

  // D1's db.batch(stmts) runs an array of prepared+bound statements as one
  // atomic transaction and returns an array of results in order.
  async function batch(stmts) {
    // De transactie-acquisitie van sql.begin() zelf kan ook wedgen (vóórdat de
    // callback met de eigen, al met withTimeout omwikkelde statements
    // start) — wrap daarom ook de buitenste promise, zodat een batch nooit
    // langer dan de timeout kan blijven hangen, ongeacht wáár in postgres.js
    // de connectie vastloopt. Ook via withFailoverRetry, maar bewust ZONDER
    // `readOnly`: een batch is per definitie een schrijfactie. Let op —
    // atomisch zijn betekent "nooit half toegepast", niet "hooguit één keer
    // toegepast": als de COMMIT op de server slaagde maar de bevestiging
    // onderweg sneuvelde, zou blind herhalen de hele transactie een tweede
    // keer toepassen. withFailoverRetry herhaalt daarom alleen als de fout
    // aantoont dat er niets is uitgevoerd.
    return withFailoverRetry((client) => withTimeout(client.begin(async (tx) => {
      const out = []
      for (const s of stmts) {
        const rows = await s._exec(tx)
        out.push({ success: true, meta: buildMeta(rows), results: rows })
      }
      return out
    })))
  }

  return { prepare, batch, get sql() { return sql } }
}

// ---------------------------------------------------------------------------
// SQL TEXT DIALECT FIXES (apply per call site, not handled by the shim):
//   datetime('now')                          -> now()
//   datetime('now', '+N days')               -> now() + interval 'N days'
//   INSERT OR IGNORE INTO t (...)             -> INSERT INTO t (...) ... ON CONFLICT DO NOTHING
//     (needs a real UNIQUE/PK constraint on the conflicting column(s) to work —
//      verify the target column has one in the translated schema)
//   RETURNING ...                             -> unchanged, already valid Postgres
//   PRAGMA table_info('x')                    -> not needed for a fresh schema;
//                                                 delete any runtime schema-introspection
//                                                 migration code entirely (see below)
//   AUTOINCREMENT / INTEGER PRIMARY KEY        -> schema-only, use
//     `id SERIAL PRIMARY KEY` (or `GENERATED ALWAYS AS IDENTITY`)
//   Booleans stored as INTEGER 0/1             -> use real BOOLEAN in Postgres;
//     code that does `row.actief` truthiness checks keeps working since JS
//     treats `true`/`false` truthily the same way as 1/0; code that explicitly
//     compares `=== 1` needs to become `=== true` (grep for this pattern per app)
//   TEXT-stored JSON columns (e.g. allowed_origins)
//     -> keep as TEXT + JSON.parse/stringify in app code (simplest, zero call-site
//        risk) rather than switching to native JSONB now; revisit later if desired
//
// ONE-TIME RUNTIME SCHEMA-MIGRATION CODE TO DELETE (fresh-start Postgres has no
// legacy shape to heal at runtime):
//   Motrac-beheer: `migrateAccountMerge()` / `ensureColumns()`-style helpers that
//   use `PRAGMA table_info` + rename-recreate-copy-drop to evolve an existing
//   SQLite DB in place. Replace with the FINAL target shape directly in the
//   Postgres migration file (e.g. `sessions` already has `user_id`, not
//   `admin_id`); delete the runtime-migration function and its call site.
