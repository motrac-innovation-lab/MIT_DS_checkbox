# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Logboek-verplichting:** dit repo valt onder `C:\DEV\CLAUDE.md`'s regel "Logboek bijhouden en delen" — elke wijziging hier loggen in `C:\DEV\Logboek\logboek.md` (+ PDF, delen in de chat); actiepunten voor Mark horen in de chat én in diezelfde logboek-entry.

## Project

**Sales offerte converter** (repo `MIT_DS_checkbox`) — een nieuwe Motrac-app,
gescaffold op 2026-09-21 uit hetzelfde generieke patroon als de rest van de
fleet, met `mit-salessupport` als norm-app: centrale login via Motrac-beheer
(`@motrac/auth-client`), gedeelde UI via `@motrac/template-ui`, i18n (NL/EN),
de Support/feedback-module en een eigen Node/Express + Postgres-backend die de
rollen server-side afdwingt.

**Er is nog geen domein.** Wat er staat is een werkend, opstartbaar skelet;
het omzetten van sales-offertes (de eerste functie) komt in een volgende stap
en de specificatie daarvan staat in een ander repo van Mark. Comments en
domeintermen in de code zijn Nederlands; houd nieuwe code daarmee consistent.

## Repo layout

```
frontend/                  Vite + React SPA (npm install && npm run dev, :5173)
backend/                   Node.js/Express API + Postgres (npm install && npm run dev, :8798)
scripts/dashboard-deploy.mjs   Dependency-vrije CLI-deploy naar control.motrac.app (fleet-kopie, verbatim)
.github/workflows/tests.yml    Testsuite (backend + frontend + typecheck/fleet-UI-poort), ook aangeroepen door deploy.yml
.github/workflows/deploy.yml   Deploy van beide apps bij push op main (pas actief na DEPLOY_INGESCHAKELD, zie DEPLOY.md)
```

Poort `8798` is de vaste lokale slot van deze app in de fleet-conventie
(motrac-beheer=8787 … mit-salessupport=8796, mit-handleiding=8797,
**MIT_DS_checkbox=8798**) — zie `backend/.env.example`. Elke map heeft een
eigen `package.json`; er is geen root-`package.json`.

**De frontend bouwt niet uit een losstaande checkout van alleen dit repo.**
`frontend/package.json` hangt via `file:../../motrac-auth-client` en
`file:../../motrac-template-ui` af van twee andere private fleet-repo's, die
als sibling-mappen naast `MIT_DS_checkbox` verwacht worden (lokaal in
`C:\DEV`). In CI zetten `tests.yml` en `deploy.yml` die structuur expliciet
neer. Bouw eerst de siblings (`npm run build` in auth-client, **`npm run
build:lib`** in template-ui — niet `build`, dat is diens demo-app).

## Commands

```bash
# Frontend
cd frontend
npm install
npm run dev            # Vite dev server, http://localhost:5173
npm run build          # check:i18n + check:fleet-ui + tsc --noEmit + vite build — DE poort
npm run typecheck      # tsc --noEmit only
npm run check:i18n     # NL/EN-pariteit + onvertaalde waarden
npm run check:fleet-ui # motrac-ui-check --streng (de negen fleet-afspraken, zie hieronder)

# Backend
cd backend
npm install
cp .env.example .env   # DATABASE_URL / FRONTEND_ORIGIN / MOTRAC_BEHEER_URL / MOTRAC_VERIFY_KEY
npm run dev            # node --watch server.js, http://localhost:8798 — migreert zichzelf bij opstarten
npm run build          # stelt backend/dist/ samen — de deploy-boom, zie scripts/build.mjs
npm test               # node:test; DB-tests slaan zichzelf over zonder TEST_DATABASE_URL
```

Tests vergen Node 22 (het glob-patroon van `node --test`); de backend zelf
draait op `node >=18` en de deploy-jobs staan op de versie van het serverpark.

---

## Beschermde basis — lees dit voordat je iets aanpast

Alles wat hieronder staat is **overgenomen uit `motrac-template-ui` en uit het
fleet-patroon van `mit-salessupport`**, op uitdrukkelijk verzoek van Mark
(2026-09-21): de basis van deze app moet gelijk blijven aan de rest van de
fleet, zodat een fix in het pakket hier vanzelf aankomt en deze app niet —
zoals `motrac-toegangsbeheer` en `motrac-bmwt-stickers` eerder — een eigen
fork wordt die structureel achterloopt.

**De regel: van niets in deze lijst wordt afgeweken zonder uitdrukkelijke,
voorafgaande toestemming van Mark in de chat.** Dat geldt voor elke sessie,
elke AI en elke collega. Een goede reden om af te wijken bestaat — maar die
reden leg je eerst voor, en pas na een expliciet "ja" pas je het aan, mét een
regel in het logboek waarom. "Het was handiger", "de typecheck klaagde" of
"het pakket heeft dit niet" zijn geen toestemming; in die gevallen is de
juiste route een wijziging **in het pakket** (`motrac-template-ui`, via
PR op `main`) of een vraag aan Mark.

### Wat beschermd is

1. **De UI komt uit `@motrac/template-ui`, en alleen daaruit.**
   - Geen Tailwind, geen ander CSS-framework, geen `lucide-react` of andere
     icoonbibliotheek, geen tweede design-system. Ontbreekt een component of
     een icoon, dan hoort hij in het pakket (`src/components/`, `Icon.tsx` via
     `scripts/lucide-paden.mjs`) — niet lokaal in deze app.
   - Geen lokale kopie of "port" van een pakket-component (`TabBar`,
     `Sidebar`, `KaartLijst`, `useMobiel`, `naarKlembord`, …). Dat is precies
     hoe de forks ontstonden die het pakket moest voorkomen.
   - `frontend/src/styles/app.css` **herdefinieert nooit een klasse die
     `global.css` van het pakket bezit** (`motrac-ui-check` controle 9). De
     app-stylesheet laadt ná `style.css` en overstemt hem dan in élke
     pakket-component, zonder waarschuwing.
   - Formuliervelden zijn `Input`/`Textarea`/`Select` uit het pakket binnen
     een `Field` — geen kale `<input>` (a11y-koppeling van fouten aan velden).
   - Paginakop is `.page-head > h1.page-h`, nooit `.t-h1`; tabellen zijn
     `DataTable` (+ `KaartLijst` onder `Q_KAART`), badges `Tag`/`StatusBadge`
     mét `tone`, kleuren via `var(--…)`/`toneKleur()` — zie
     `motrac-template-ui/docs/UI-UX-PLAN-PER-APP.md` §1 voor de volledige norm.

2. **`npm run build` in `frontend/` is de poort, en die wordt niet afgezwakt.**
   `check:i18n && check:fleet-ui && tsc --noEmit && vite build`, met
   `motrac-ui-check --streng` (niet zonder `--streng`). Een rode check los je
   op in de code, niet door de check te verwijderen, een bestand uit te
   sluiten of `/* fleet-ui: negeer */` te strooien. `scripts/check-i18n-parity.mjs`
   is een fleet-brede kopie en wordt hier niet uitgebreid; waardenuitzonderingen
   staan met motivatie in `scripts/i18n-gelijke-waarden.mjs`.

3. **Bestanden die letterlijk uit het template/de fleet komen.** Wijzig ze
   alleen om ze gelijk te trekken met de bron, nooit om er hier iets eigens
   van te maken:
   - `frontend/index.html` — het thema-script vóór de eerste paint, de
     `theme-color`-mapping, de twee font-preloads, geen font-CDN.
   - `frontend/vite.config.ts` — `resolve.dedupe: ['react', 'react-dom',
     'react-router-dom']`. Zonder dit een lege pagina na login (twee
     router-instanties via de `file:`-symlinks). Nieuwe peer-dep van het
     pakket → hier ook.
   - `frontend/src/main.tsx` — provider-volgorde `BrowserRouter > ThemeProvider
     > AuthProvider`, `'./i18n'` als side-effect import, `style.css` vóór
     `app.css`.
   - `frontend/src/App.tsx` — `UiTekstBrug` (`UiTextProvider` om de hele
     routeboom), `TaalKiezer` op `i18n.resolvedLanguage`, de shell-bedrading
     met `AppShell` + `FeedbackWidget mobielInMenu` + `feedbackMenuTab` +
     `useFeedbackPad`, en tabs met een ECHT pad (nooit `to="/"`).
   - `frontend/src/context/AuthContext.tsx` + `frontend/src/lib/motracAuth.ts`
     — de dunne brug over `@motrac/auth-client`; login/sessie/SSO-logica
     wordt hier niet nagebouwd. De rol-afleiding (gebruiker/admin, onbekend
     → gebruiker) is de enige app-eigen laag.
   - `frontend/src/lib/api.ts` — de ene fetch-helper voor `/api/*`
     (bearer, fout-envelop, `motrac:sessie-verlopen` bij 401). Geen losse
     `fetch()` per pagina.
   - `frontend/src/i18n/index.ts` + `languages.ts` — de i18next-init uit de
     base-gids; `LANGUAGE_STORAGE_KEY` blijft `mit-ds-checkbox-language`.
   - Het `ui`-blok in `frontend/src/i18n/locales/{nl,en}/common.json` spiegelt
     `STANDAARD_UI_TEKSTEN` uit het pakket (0.9.1). Komt er in het pakket een
     sleutel bij (zie diens CHANGELOG), zet hem in beide talen erbij; haal er
     nooit een weg. `ui.feedback`/`ui.feedbackGeven` = "Support" (0.9.0).
   - `frontend/public/fonts/*`, `frontend/public/motrac-logo.svg`,
     `frontend/public/favicon.png` — de merk-assets, byte-gelijk aan
     `motrac-template-ui/public/`. Het logo niet rasteriseren, hertekenen of
     thematiseren; Inter alleen self-hosted (BRANDING.md).
   - `backend/db.js`, `backend/lib/migrate.js`, `backend/lib/startup-check.js`,
     `backend/scripts/build.mjs`, `backend/scripts/migrate.mjs`,
     `scripts/dashboard-deploy.mjs` — verbatim fleet-kopieën.
   - De **mount-volgorde in `backend/server.js`** en de opstartketen
     (trust proxy → `/api/_health*` → `cors` → storingsmodus-gate → rate
     limiter → route-specifieke body-parsers → generieke 256kb-parser →
     bearer-auth-gate → routes → 404 → error-middleware; migreren vóór
     `listen`, `0.0.0.0`, geen top-level `await`, geen `process.exit`). Zie
     "Productie-hardening" hieronder voor waarom elk punt bestaat.
   - `.github/workflows/tests.yml` en `deploy.yml` — de sibling-checkouts met
     de pin op `motrac-template-ui@main`, op **twee** plekken tegelijk bij te
     werken.

4. **De pin op `motrac-template-ui` staat op `main`** (de enige langlevende
   branch daar), via de `file:`-symlink lokaal en de sibling-checkout in CI.
   Niet vervangen door een SHA, een tag of een eigen branch zonder Mark:
   dan stroomt een fix in het pakket hier niet meer door. Loopt het pakket
   ooit iets kapot, dan is een `v<versie>`-tag daar de noodrem — tijdelijk,
   en gemeld.

### Hoe je wél iets verandert

- **Iets ontbreekt in het pakket** → PR op `motrac-template-ui@main` (met
   styleguide-regel en changelog, zie diens CLAUDE.md), daarna `npm run
   build:lib` daar en hier gewoon importeren.
- **Een stijl is echt domein-specifiek** → `frontend/src/styles/app.css`, met
  een eigen klassenaam (bv. `.offerte-…`), elke `:hover` achter
  `@media (hover:hover) and (pointer:fine)`, geen `font-size` onder 12px.
- **Je wilt van een beschermd punt afwijken** → leg het in de chat aan Mark
  voor met reden en alternatief; pas na expliciete toestemming aanpassen, en
  noteer de toestemming in de logboek-entry én in een comment bij de wijziging.

### Wat `motrac-ui-check --streng` bewaakt

Bij elke `npm run build` in `frontend/` (controles 1–9 uit
`motrac-template-ui/scripts/check-fleet-ui.mjs`): geen font-CDN; de acht
Inter-WOFF2's + logo in `public/`; `style.css` geïmporteerd; `dedupe` met
`react-router-dom`; geen hardcoded hex in `.tsx`; elke `:hover` gegate; geen
`font-size` onder 12px; README noemt de template-ui-versie; app-CSS
herdefinieert geen pakketklasse.

---

## Architecture

**Eigen backend, eigen Postgres.** `backend/server.js` serveert alleen
`/api/*`; de frontend (Vite-build in `frontend/dist/`) wordt los gebouwd en
als `static_upload`-applicatie geserveerd. Twee dashboard-applicaties, twee
deploy-tokens (zie `DEPLOY.md`).

**Auth is centraal, niet lokaal.** Geen lokale accounts. Login via
Motrac-beheer met `@motrac/auth-client`; de backend verifieert élk
`/api/*`-request server-side (`POST /api/v1/<slug>/verify` met `X-Api-Key`,
60s per-proces gecachet). `APP_SLUG` in `server.js`, `DEFAULT_SLUG` in
`frontend/src/lib/motracAuth.ts` en de CI-variabele `VITE_MOTRAC_AUTH_SLUG`
zijn nu alle drie de **placeholder `mit-ds-checkbox`** — de app is nog niet in
Toegangsbeheer geregistreerd. Zodra dat gebeurd is: alle drie tegelijk op de
toegekende slug zetten. Rollen: de twee standaard `app_rollen` van
Motrac-beheer (`gebruiker`/`admin`); `requireAdmin` in de backend is de
echte grens, een `isAdmin`-check in de UI alleen cosmetiek.

### API-oppervlak (`backend/server.js`)

| Route | Auth | Doel |
|---|---|---|
| `GET /api/_health` | geen | Opstartdiagnose: fase/fout, welke env-vars gezet zijn (nooit de waarden). Vóór de rate limiter en de auth-gate gemount, dus antwoordt ook in storingsmodus. |
| `GET /api/_health/beheer` | geen | Doet de `/verify`-call naar Motrac-beheer met een opzettelijk ongeldig token, zodat "koppeling kapot" te onderscheiden is van "token verlopen". |
| `GET /api/data` | bearer | Bootstrap: `config` (alleen `CONFIG_WHITELIST`, nu leeg). Hier haakt de datalaag straks aan. |
| `POST /api/feedback` | bearer | Doorgifte van de FeedbackWidget naar Motrac-beheer; eigen 12mb-body-limiet vanwege screenshots. |
| `GET /api/audit-log` | `requireAdmin` | Server-side gepagineerd logboek (`logAction`/`logActionZachtjes`). |
| `PUT /api/config/:key` | `requireAdmin` | Alleen `CONFIG_WHITELIST`-sleutels (fail-closed). |

`CONFIG_WHITELIST` bepaalt zowel wat bewerkbaar is als wat `GET /api/data`
teruggeeft — de config-tabel bevat ook `MOTRAC_VERIFY_KEY` (fallback als de
env-var ontbreekt), en die hoort nooit bij een gebruiker te belanden.

### Volgende stap: het domein

Volg het patroon van `mit-salessupport` (zie diens CLAUDE.md, "Architecture"):
een `DataProvider`-interface in `frontend/src/lib/dataProvider.ts`, een
`ApiDataProvider` op `lib/api.ts`, een `MockDataProvider` voor UI-werk zonder
backend (`VITE_DATA_BACKEND=mock`), een `DataContext` die de providers op
React-acties bedraadt, en per operatie de route in `server.js` plus een
migratie in `backend/migrations/` (viercijferig, aansluitend, idempotent —
`test/migraties.test.js` bewaakt de reeks). Een nieuwe admin-route hoort in
`BEHEERDERROUTES` in `test/auth.test.js`; een nieuw runtime-bestand in
`COPY_ENTRIES` van `scripts/build.mjs` (anders faalt `test/syntax.test.js`).
Per rij een `Tag` mét `tone`, per lijst een `DataTable` én een `KaartLijst`
uit dezelfde celfuncties, paginering via `Pagination` uit het pakket.

## i18n

Twee talen (NL is de referentie, EN de vertaling) en twee namespaces:
`common`, `auth`. Elke namespace staat met de hand geregistreerd in
`frontend/src/i18n/index.ts` — toevoegen = twee JSON-bestanden + twee imports
+ twee regels in `resources`. `npm run build` draait `check:i18n` als eerste
stap: `check-i18n-parity.mjs` (sleutelpariteit, fleet-kopie) en
`check-i18n-values.mjs` (een sleutel die in `en/` nog letterlijk de
Nederlandse tekst heeft); terechte gelijkenissen staan met motivatie in
`scripts/i18n-gelijke-waarden.mjs`.

De `LanguageSwitcher` staat in het `acties`-slot van `AppShell` en krijgt
`i18n.resolvedLanguage` (niet `i18n.language`), zie `TaalKiezer` in `App.tsx`.

## Tests

```bash
cd backend && npm test      # node:test; DB-tests slaan zichzelf over zonder TEST_DATABASE_URL
cd frontend && npm run check:i18n
```

- `backend/test/syntax.test.js` — `node --check` over elk bestand, en de
  module-graaf vanaf `dist/server.js` (een `lib/`-bestand dat in
  `COPY_ENTRIES` ontbreekt faalt hier, niet in productie).
- `backend/test/auth.test.js` — de bearer-gate, de verify-cache en elke
  `requireAdmin`-route met een gebruikerstoken (start de échte server tegen
  een wegwerp-database en een nep-Motrac-beheer, `test/helpers/`).
- `backend/test/storingsmodus.test.js` — mislukt opstarten houdt de poort
  open, `/api/_health` noemt de oorzaak, de 503 draagt CORS-headers, de
  connectiestring lekt niet.
- `backend/test/migraties.test.js` — idempotentie (drie keer draaien) en een
  gesloten nummerreeks.
- CI (`tests.yml`) draait de backend-suite mét Postgres-service en faalt als
  er tests overgeslagen zijn; de typecheck-job bouwt de siblings en draait
  `tsc` + `motrac-ui-check --streng`.

## Productie-hardening

Geërfd van de fleet (zie `mit-salessupport/CLAUDE.md` voor de achtergrond van
elk punt, en `motrac-bmwt-stickers/CLAUDE.md` voor de oorsprong):

1. **Zelf-migrerend bij opstarten**, vóór `app.listen`, met een advisory lock
   zodat de cluster-workers elkaar niet in de weg zitten. Idempotent schrijven
   (`IF NOT EXISTS` / `ON CONFLICT` / `information_schema`-guarded `DO $$`).
2. **Multi-host `DATABASE_URL` (failover)** wordt echt afgedwongen door
   `db.js` (`resolveWritableConnectionString`/`withFailoverRetry`); een
   schrijfactie met onbekende uitkomst wordt nooit blind herhaald
   (`DB_STATE_UNKNOWN`, status 500).
3. **Verplichte env-vars gevalideerd bij opstarten**; bij een mislukte start
   géén `process.exit` maar **storingsmodus**: poort open, `/api/_health`
   meldt de oorzaak, elke andere route een 503 mét CORS-headers.
4. **Mount-volgorde is functioneel** (zie "Beschermde basis", punt 3).
5. **`resolve.dedupe`** in `vite.config.ts` — niet verwijderen.
6. **`VITE_*` wordt in de bundel gebakken**: URL-wijziging = rebuild.
   Controleer: `grep -o "https://[a-z0-9]*\.dev\.motrac\.app" dist/assets/index-*.js | sort -u`.
7. **Secrets komen nooit in de upload**: `build.mjs`' allowlist + `.env`-scan
   en `dashboard-deploy.mjs`' eigen `.env`-detectie.
8. **Cluster mode**: `listen()` onvoorwaardelijk op moduleniveau,
   `Number(process.env.PORT)`, `0.0.0.0`, geen in-memory state die per worker
   verschilt (de verify-cache is bewust alleen een cache).

## Deploy

Zie `DEPLOY.md`. Kort: twee dashboard-applicaties op `control.motrac.app`
(backend `node_upload`, frontend `static_upload`), GitHub Actions
`deploy.yml` bij push op `main` — pas actief nadat de repository-variabele
`DEPLOY_INGESCHAKELD=true` staat en de secrets/variabelen uit `DEPLOY.md`
gezet zijn. `frontend/package-lock.json` legt de `bin`-lijst van de siblings
vast en CI draait `npm ci`: neem je een nieuw sibling-commando in gebruik,
regenereer dan de lockfile mét beide siblings als buurmappen en controleer met
`rm -rf node_modules && npm ci && npm run build`.
