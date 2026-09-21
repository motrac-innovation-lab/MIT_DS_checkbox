# Sales offerte converter · Motrac

Nieuwe Motrac-app (repo `MIT_DS_checkbox`), gescaffold uit hetzelfde generieke
patroon als de rest van de fleet, met `mit-salessupport` als norm: centrale
authenticatie via **Motrac-beheer** (`@motrac/auth-client`), gedeelde UI via
**`@motrac/template-ui`**, i18n (NL/EN), de Support-module en een eigen
Node/Express-backend met PostgreSQL die de rollen server-side afdwingt.

Er is nog **geen domeinfunctionaliteit**: dit is een werkend, opstartbaar
skelet. Het omzetten van sales-offertes komt in de volgende stap.

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
npm run build          # i18n-check + fleet-UI-poort + typecheck + productiebuild

# Backend
cd backend
npm install
cp .env.example .env   # DATABASE_URL / FRONTEND_ORIGIN / MOTRAC_BEHEER_URL / MOTRAC_VERIFY_KEY
npm run dev            # http://localhost:8798 — migreert zichzelf bij opstarten
npm test
```

Zonder database start de backend in **storingsmodus**: `GET /api/_health`
vertelt wat er ontbreekt.

## Projectstructuur

```
frontend/src/
  context/AuthContext.tsx   Brug over @motrac/auth-client (rol-afleiding gebruiker/admin)
  lib/motracAuth.ts         De ene auth-client-instantie
  lib/api.ts                De ene fetch-helper voor /api/*
  lib/feedback.ts           Transport van de FeedbackWidget naar POST /api/feedback
  i18n/                     languages.ts · index.ts · locales/{nl,en}/{common,auth}.json
  modules/auth/             LoginPage · ChangePasswordPage
  modules/home/             HomePage (startpagina van het skelet)
  App.tsx                   Routes + AppShell + UiTextProvider-brug
  main.tsx                  Providers + router
backend/
  server.js                 De hele API (health, auth-gate, feedback, logboek, config)
  db.js                     Postgres-shim met failover-resolutie
  lib/                      migrate.js · startup-check.js
  migrations/               0001_init.sql (config) · 0002_audit_log.sql
  scripts/                  build.mjs (deploy-boom) · migrate.mjs
  test/                     node:test-suite tegen de échte server + wegwerp-DB
```

## Deploy

Zie `DEPLOY.md`.
