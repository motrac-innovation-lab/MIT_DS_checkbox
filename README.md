# Sales offerte converter · Motrac

Nieuwe Motrac-app (repo `MIT_DS_checkbox`), gescaffold uit hetzelfde generieke
patroon als de rest van de fleet, met `mit-salessupport` als norm: centrale
authenticatie via **Motrac-beheer** (`@motrac/auth-client`), gedeelde UI via
**`@motrac/template-ui`**, i18n (NL/EN), de Support-module en een eigen
Node/Express-backend met PostgreSQL die de rollen server-side afdwingt.

**Wat de app doet:** een Word-offerte (`.docx`) uit de configurator omzetten
naar een PDF met verborgen DocuSign-ankers. Per checkbox (☐ of het Wingdings
2-vakje) komt `\cb_001\`, `\cb_002\`, … als witte 1pt-tekst in de tekstlaag,
direct links van het zichtbare vakje; Salesforce Apex maakt daar de
DocuSign-`CheckboxTab`s van. De lettertypen van het brondocument (DaxPro,
DaxPro-Bold, DaxPro-Light, DaxPro-Medium) blijven in de PDF behouden zodra de fontbestanden
in `backend/fonts/` staan. Geport uit `markkuijpers31-lab/esign_motrac`
(Java/Spring, PoC) op 2026-09-21 — dat repo is daarmee vervangen.

De render doet **LibreOffice** (`soffice --headless`), lokaal op de server of
via een externe Gotenberg-dienst; een pure-JS alternatief met Word-getrouwe
layout bestaat niet. Zie `DEPLOY.md` voor wat dat op het serverpark vraagt.

> **Beschermde basis.** Alles wat uit `motrac-template-ui` en het fleet-patroon
> is overgenomen mag niet zonder uitdrukkelijke toestemming van Mark worden
> aangepast — zie `CLAUDE.md`, "Beschermde basis".

## UI-laag

Gebouwd en getest tegen **`@motrac/template-ui` 0.9.1** (zie de
`CHANGELOG.md` van dat pakket). Er is geen installatie-gate: via de
`file:`-symlink draait deze app altijd wat er in `dist-lib/` van dat pakket
staat. `npm run build` in `frontend/` draait `motrac-ui-check --streng` als
poort op de fleet-afspraken.

## Tech

- **Vite** + **React 18** + **TypeScript** (`frontend/`)
- **Node.js** + **Express** + **PostgreSQL** (`backend/`)
- **react-router** — routing; **i18next** — NL/EN
- Design system uit `@motrac/template-ui`; auth uit `@motrac/auth-client`

## Aan de slag

Deze repo verwacht `motrac-template-ui` en `motrac-auth-client` als
sibling-mappen (lokaal in `C:\DEV`). Bouw die eerst:

```bash
cd ../motrac-auth-client && npm install && npm run build
cd ../motrac-template-ui && npm install && npm run build:lib   # build:lib, niet build
```

```bash
# Frontend
cd frontend
npm install
cp .env.example .env   # VITE_API_BASE_URL / VITE_MOTRAC_AUTH_URL / VITE_MOTRAC_AUTH_SLUG
npm run dev            # http://localhost:5173
npm run build          # i18n-check + rondleiding-check + fleet-UI-poort + typecheck + productiebuild

# Backend
cd backend
npm install
cp .env.example .env   # DATABASE_URL / FRONTEND_ORIGIN / MOTRAC_BEHEER_URL / MOTRAC_VERIFY_KEY
npm run dev            # http://localhost:8798 — migreert zichzelf bij opstarten
npm test               # met TEST_DATABASE_URL ook de DB- en servertests
```

Voor de conversie zelf moet **LibreOffice** geïnstalleerd zijn (`soffice` op
het PATH, of `LIBREOFFICE_COMMAND` in `.env`; Windows:
`C:\Program Files\LibreOffice\program\soffice.exe`). Zonder start de app
gewoon, maar meldt de statuskaart dat omzetten niet kan. Leg de
DaxPro-fontbestanden in `backend/fonts/` (zie de README daar).

Zonder backend aan de UI werken: `VITE_DATA_BACKEND=mock` in `frontend/.env`.

Zonder database start de backend in **storingsmodus**: `GET /api/_health`
vertelt wat er ontbreekt.

## Projectstructuur

```
frontend/src/
  context/AuthContext.tsx   Brug over @motrac/auth-client (rol-afleiding gebruiker/admin)
  context/DataContext.tsx   Bedraadt de datalaag (Api- of MockDataProvider) op de shell
  lib/motracAuth.ts         De ene auth-client-instantie
  lib/api.ts                De ene fetch-helper voor /api/*
  lib/dataProvider.ts       Het contract van de datalaag; apiDataProvider.ts · mockDataProvider.ts
  lib/bestanden.ts          File ↔ base64, leesbare grootte
  lib/feedback.ts           Transport van de FeedbackWidget naar POST /api/feedback
  i18n/                     languages.ts · index.ts · locales/{nl,en}/{common,auth,rondleiding}.json
  modules/auth/             LoginPage · ChangePasswordPage
  modules/conversie/        ConversiePage — statuskaart, upload, resultaat + download
  modules/geschiedenis/     GeschiedenisPage — het conversies-logboek (admin)
  rondleiding/              De ingebouwde uitleg: stappen.ts (data) · RondleidingContext · overlay · /rondleiding
  App.tsx                   Routes + AppShell + UiTextProvider-brug
  main.tsx                  Providers + router
backend/
  server.js                 De hele API (health, auth-gate, conversies, feedback, logboek, config)
  db.js                     Postgres-shim met failover-resolutie
  lib/                      docxVoorbewerking · docxNaarPdf · pdfCheckboxAnkers · lettertypen · conversie
                            · migrate.js · startup-check.js
  fonts/                    *.ttf/*.otf voor LibreOffice (DejaVu Sans meegeleverd; DaxPro aan te leveren)
  migrations/               0001_init.sql · 0002_audit_log.sql · 0003_conversies.sql
  scripts/                  build.mjs (deploy-boom) · migrate.mjs
  test/                     node:test-suite tegen de échte server + wegwerp-DB (+ LibreOffice indien aanwezig)
```

## Deploy

Zie `DEPLOY.md`.
