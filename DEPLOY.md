# Deploy — MIT_DS_checkbox (Sales offerte converter)

**Nog niet live.** De twee dashboard-applicaties bestaan nog niet; deze pagina
is de checklist om ze aan te maken en de automatische deploy in te schakelen.
Zelfde opzet als `mit-salessupport/DEPLOY.md`: geen Cloudflare, backend en
frontend als twee losse applicaties op het IT Dashboard (`control.motrac.app`),
elk met een eigen `DASHBOARD_DEPLOY_TOKEN`.

## Wat er gedeployed wordt

- **Backend** (`node_upload`): `backend/scripts/build.mjs` stelt
  `backend/dist/` samen uit een expliciete allowlist (`server.js`, `db.js`,
  `lib/`, `migrations/`, uitgeklede `package.json`). Nooit de rauwe map — een
  `.env` in `backend/` zou anders op elke replica belanden. De doelserver
  draait zelf `npm install`; migreren gebeurt bij het opstarten.
- **Frontend** (`static_upload`): `frontend/dist/`, gebouwd met de echte
  `VITE_*`-waarden erin gebakken. Een URL-wijziging = opnieuw bouwen.

## Volgorde bij de eerste deploy

1. **Motrac Toegangsbeheer**: registreer de app in AppManager en noteer de
   slug en de API-key. Zet de slug op drie plekken: `APP_SLUG` in
   `backend/server.js`, `DEFAULT_SLUG` in `frontend/src/lib/motracAuth.ts`
   en de repository-variabele `VITE_MOTRAC_AUTH_SLUG` (nu overal de
   placeholder `mit-ds-checkbox`).
2. **Dashboard**: maak twee applicaties aan — backend (`node_upload`) en
   frontend (`static_upload`) — en genereer per applicatie een persoonlijk
   deploy-token (**Deploy tokens → Genereer mijn token**; wordt één keer
   getoond).
3. **Database**: provisioneer een Postgres (bv. `motrac_ds_checkbox`) op de
   Databases-pagina en plak de verbindingsstring in het Environment-paneel
   van de backend-applicatie als `DATABASE_URL`. Zet daar ook
   `FRONTEND_ORIGIN` (de frontend-URL), `MOTRAC_BEHEER_URL`
   (`https://9x24841z85.dev.motrac.app`) en `MOTRAC_VERIFY_KEY`.
   `PORT` en `NODE_ENV` zet het platform zelf.
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
- `GET https://<backend>/api/_health/beheer` → `oordeel: "koppeling werkt …"`.
- De frontend-bundel bevat de juiste backend-URL:
  `grep -o "https://[a-z0-9]*\.dev\.motrac\.app" dist/assets/index-*.js | sort -u`.
