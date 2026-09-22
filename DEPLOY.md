# Deploy — MIT_DS_checkbox (Sales offerte converter)

**Nog niet live.** De twee dashboard-applicaties bestaan nog niet; deze pagina
is de checklist om ze aan te maken en de automatische deploy in te schakelen.
Zelfde opzet als `mit-salessupport/DEPLOY.md`: geen Cloudflare, backend en
frontend als twee losse applicaties op het IT Dashboard (`control.motrac.app`),
elk met een eigen `DASHBOARD_DEPLOY_TOKEN`.

## Vereiste op de backend-servers: LibreOffice

De offerte-conversie rendert de `.docx` met **LibreOffice headless**. Het
platform-contract (Node 24, `node_upload`, `npm install` op de doelserver)
levert dat niet mee en een `npm`-dependency kan het niet vervangen — een
pure-JS DOCX-renderer met Word-getrouwe layout bestaat niet. Er zijn twee
routes; welke het wordt is een keuze van Mark, de code werkt met beide zonder
wijziging:

| Route | Wat er nodig is | Config |
|---|---|---|
| **A. LibreOffice op de fleet-server** (standaard) | Eenmalig door de serverbeheerder op elke `backend`-server: `apt-get install --no-install-recommends libreoffice-writer` (Writer + core, geen GUI). Fonts hoeven niet systeembreed: die komen uit `backend/fonts/`. | niets extra; evt. `LIBREOFFICE_COMMAND` als `soffice` niet op het PATH staat |
| **B. Externe LibreOffice-dienst (Gotenberg)** | Een [Gotenberg](https://gotenberg.dev)-container op een machine die dat wél mag (bv. de bestaande Proxmox), met de DaxPro-fonts in de image (`COPY fonts/ /usr/local/share/fonts/`). Bereikbaar vanaf de fleet-servers. | `DOCX_PDF_ENGINE=gotenberg`, `GOTENBERG_URL=http://…:3000` |

Zonder een van beide start de app gewoon op (geen storingsmodus), maar toont
de statuskaart "omzetten niet mogelijk" en geeft `POST /api/conversies` een
503 `CONVERSIE_ENGINE_ONBESCHIKBAAR`. Controle na een deploy:
`GET /api/_health` → `conversie.libreofficeGevonden: true`.

**Lettertypen.** DaxPro, DaxPro-Light en DaxPro-Medium moeten als `.ttf`/`.otf`
beschikbaar zijn, anders vervangt LibreOffice ze en verschuift de layout. Drie
plekken, in volgorde van voorkeur: `backend/fonts/` in het repo (gaat mee in de
deploy-boom), `/uploads/fonts/` (persistente opslag aanzetten op het dashboard;
houdt de commerciële fontbestanden buiten git), of `FONTS_DIR=…` in het
Environment-paneel. `GET /api/_health` → `conversie.vereisteLettertypenOntbreken`
moet `[]` zijn. Zie `backend/fonts/README.md`.

**Geheugen.** Eén LibreOffice-render piekt op 400–600 MB; standaard 2
gelijktijdige renders per worker (`CONVERSIE_MAX_GELIJKTIJDIG`), en cluster
mode geeft één worker per core. Reken daar op bij het kiezen van de server.

## Wat er gedeployed wordt

- **Backend** (`node_upload`): `backend/scripts/build.mjs` stelt
  `backend/dist/` samen uit een expliciete allowlist (`server.js`, `db.js`,
  `lib/`, `migrations/`, `fonts/`, uitgeklede `package.json`). Nooit de rauwe map — een
  `.env` in `backend/` zou anders op elke replica belanden. De doelserver
  draait zelf `npm install`; migreren gebeurt bij het opstarten.
- **Frontend** (`static_upload`): `frontend/dist/`, gebouwd met de echte
  `VITE_*`-waarden erin gebakken. Een URL-wijziging = opnieuw bouwen.

## Volgorde bij de eerste deploy

1. **Motrac Toegangsbeheer**: registreer de app in AppManager en noteer de
   slug en de API-key. Zet de slug op drie plekken: `APP_SLUG` in
   `backend/server.js`, `DEFAULT_SLUG` in `frontend/src/lib/motracAuth.ts`
   en de repository-variabele `VITE_MOTRAC_AUTH_SLUG`. Sinds 2026-09-22 is de
   toegekende slug **`esigntool`** en staan die drie daar alle drie op.
   Zet in AppManager ook de frontend-origin in de CORS-allowlist van de app,
   anders blokkeert de browser de login met de melding dat er geen
   `Access-Control-Allow-Origin`-header is — zie punt 5.
2. **Dashboard**: maak twee applicaties aan — backend (`node_upload`) en
   frontend (`static_upload`) — en genereer per applicatie een persoonlijk
   deploy-token (**Deploy tokens → Genereer mijn token**; wordt één keer
   getoond).
3. **Database**: provisioneer een Postgres (bv. `motrac_ds_checkbox`) op de
   Databases-pagina en plak de verbindingsstring in het Environment-paneel
   van de backend-applicatie als `DATABASE_URL`. Zet daar ook
   `FRONTEND_ORIGIN` (de frontend-URL), `MOTRAC_BEHEER_URL` en
   `MOTRAC_VERIFY_KEY`. **`MOTRAC_BEHEER_URL` is de API van Motrac-beheer,
   `https://9x24841z85.dev.motrac.app` — niet `https://portaal.motrac.app`.**
   Dat laatste is de webpagina; die serveert op élk pad de SPA, dus ook op
   `/api/v1/<slug>/verify`, met status 200 en HTML. De tokencontrole mislukt
   dan bij elk verzoek en de browser klaagt tegelijk over een ontbrekende
   `Access-Control-Allow-Origin`, wat de aandacht ten onrechte naar de
   CORS-allowlist trekt. Hetzelfde geldt voor `VITE_MOTRAC_AUTH_URL` bij de
   repository-variabelen (kostte 2026-09-22 een halve ochtend).
   `PORT` en `NODE_ENV` zet het platform zelf. Optioneel voor de conversie:
   `DOCX_PDF_ENGINE`/`GOTENBERG_URL` (route B hierboven), `LIBREOFFICE_COMMAND`,
   `FONTS_DIR`, `CONVERSIE_MAX_GELIJKTIJDIG`, `LIBREOFFICE_TIMEOUT_SECONDEN`
   (zie `backend/.env.example`).
4. **GitHub → Settings → Secrets and variables → Actions**:
   - Secrets: `BACKEND_DASHBOARD_DEPLOY_TOKEN`, `FRONTEND_DASHBOARD_DEPLOY_TOKEN`,
     `FLEET_REPO_READ_TOKEN` (PAT/App-token met leestoegang tot
     `motrac-template-ui` en `motrac-auth-client`).
   - Variables: `VITE_API_BASE_URL` (de backend-URL), `VITE_MOTRAC_AUTH_URL`
     (`https://9x24841z85.dev.motrac.app`), `VITE_MOTRAC_AUTH_SLUG` (de slug
     uit stap 1), en als laatste `DEPLOY_INGESCHAKELD=true`.
5. **CORS, twee kanten**: de frontend-origin in de allowlist van de app in
   Motrac-beheer (voor login/SSO vanuit de SPA) én in `FRONTEND_ORIGIN` van
   deze backend (voor de eigen `/api/*`-calls). Twee losse lijsten.
6. Push naar `main` (of `workflow_dispatch`): `deploy.yml` draait eerst
   `tests.yml` en deployt daarna backend én frontend.
7. Vul hierboven de echte URL's in en zet "Nog niet live" op "Live sinds …".

## Waarom `DEPLOY_INGESCHAKELD`

Zonder die variabele zouden de deploy-jobs bij élke push op `main` rood worden
op ontbrekende secrets, terwijl de tests groen zijn — ruis die de echte fouten
verbergt. De jobs draaien daarom pas als `vars.DEPLOY_INGESCHAKELD == 'true'`
of bij een handmatige `workflow_dispatch`.

## Handmatig vanaf de CLI

Hetzelfde script als CI: `DASHBOARD_DEPLOY_TOKEN` in de omgeving (nooit als
CLI-flag — het script weigert dat en redigeert het token uit alle uitvoer),
dan vanuit `backend/` of `frontend/`:

```bash
set -a; source .env; set +a
node ../scripts/dashboard-deploy.mjs --message "wat er verandert"
```

Config komt uit `.dashboarddeploy.json` in die map (`dashboardUrl`,
`buildDir`, `buildCommand`). Het script breekt af als het een `.env`-achtig
bestand in de upload aantreft.

## Controles na een deploy

- `GET https://<backend>/api/_health` → `fase: "klaar"`, alle `envAanwezig`
  op `true`. Bij `mislukt` staat de oorzaak in `fout`.
- `GET https://<backend>/api/_health/beheer` → `bruikbaar: true`. Staat er
  `false`, dan noemt `oordeel` de oorzaak: een webpagina in plaats van de API,
  een geweigerde `MOTRAC_VERIFY_KEY`, of een onbekende slug.
- `GET https://<backend>/api/_health` → `conversie.libreofficeGevonden: true`
  en `conversie.vereisteLettertypenOntbreken: []` (anders: LibreOffice resp.
  de DaxPro-bestanden ontbreken op de server — zie boven).
- Eén echte offerte omzetten en de PDF openen: de ☐'s zijn zichtbaar, het
  lettertype is DaxPro, en `pdftotext` (of de statuskaart) toont `\cb_001\`…
- De frontend-bundel bevat de juiste backend-URL:
  `grep -o "https://[a-z0-9]*\.dev\.motrac\.app" dist/assets/index-*.js | sort -u`.
