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

**Het domein: offerte-conversie voor DocuSign** — geport uit het oude repo
`markkuijpers31-lab/esign_motrac` (Java/Spring Boot + PDFBox + LibreOffice,
PoC op een Proxmox-LXC) op 2026-09-21. Een `.docx` uit de configurator wordt
voorbewerkt, door LibreOffice naar PDF gerenderd en per checkbox voorzien van
een verborgen DocuSign-anker in de tekstlaag; Salesforce Apex maakt daar de
DocuSign-velden van. Zie "Offerte-conversie" hieronder. Comments en
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
npm run dev              # Vite dev server, http://localhost:5173
npm run build            # check:i18n + check:rondleiding + check:fleet-ui + tsc --noEmit + vite build — DE poort
npm run typecheck        # tsc --noEmit only
npm run check:i18n       # NL/EN-pariteit + onvertaalde waarden
npm run check:rondleiding # de rondleiding tegen de app (ankers, routes, teksten)
npm run check:fleet-ui   # motrac-ui-check --streng (de negen fleet-afspraken, zie hieronder)

# Backend
cd backend
npm install
cp .env.example .env   # DATABASE_URL / FRONTEND_ORIGIN / MOTRAC_BEHEER_URL / MOTRAC_VERIFY_KEY
npm run dev            # node --watch server.js, http://localhost:8798 — migreert zichzelf bij opstarten
npm run build          # stelt backend/dist/ samen — de deploy-boom, zie scripts/build.mjs
npm test               # node:test; DB-tests slaan zichzelf over zonder TEST_DATABASE_URL
```

Tests vergen Node 22 (het glob-patroon van `node --test`); de backend zelf
draait op `node >=20` (eis van `pdfjs-dist`) en de deploy-jobs staan op de
versie van het serverpark (Node 24). **Lokaal en op de server moet LibreOffice
(`soffice`) op het PATH staan** voor de conversie zelf — zonder start de app
gewoon op, maar geeft elke conversie een 503 (zie "Offerte-conversie").

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
   `check:i18n && check:rondleiding && check:fleet-ui && tsc --noEmit && vite
   build`, met `motrac-ui-check --streng` (niet zonder `--streng`).
   `check:rondleiding` is er op 2026-09-22 bij gekomen met de rondleiding (zie
   hieronder) — een controle ERBIJ, nooit eentje eraf. Een rode check los je
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
     `useFeedbackPad`, en tabs met een ECHT pad (nooit `to="/"`). De
     `RondleidingProvider` + `<Rondleiding />` eromheen en de tab
     `/rondleiding` horen sinds 2026-09-22 bij die bedrading; al het andere
     hierboven is onveranderd.
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
staan sinds 2026-09-22 alle drie op de toegekende slug **`esigntool`**. Die
drie horen altijd gelijk te zijn: lopen ze uiteen, dan logt de gebruiker wél
in maar geeft elke `/api/*`-route een 401, omdat het token voor de ene app is
uitgegeven en hier tegen de andere wordt gecontroleerd. Rollen: de twee standaard `app_rollen` van
Motrac-beheer (`gebruiker`/`admin`); `requireAdmin` in de backend is de
echte grens, een `isAdmin`-check in de UI alleen cosmetiek.

### API-oppervlak (`backend/server.js`)

| Route | Auth | Doel |
|---|---|---|
| `GET /api/_health` | geen | Opstartdiagnose: fase/fout, welke env-vars gezet zijn (nooit de waarden). Vóór de rate limiter en de auth-gate gemount, dus antwoordt ook in storingsmodus. |
| `GET /api/_health/beheer` | geen | Doet de `/verify`-call naar Motrac-beheer met een opzettelijk ongeldig token, zodat "koppeling kapot" te onderscheiden is van "token verlopen". |
| `GET /api/data` | bearer | Bootstrap: `config` (alleen `CONFIG_WHITELIST`, nu leeg). |
| `POST /api/feedback` | bearer | Doorgifte van de FeedbackWidget naar Motrac-beheer; eigen 12mb-body-limiet vanwege screenshots. |
| `GET /api/conversies/status` | bearer | Render-engine (LibreOffice gevonden + versie, of Gotenberg bereikbaar) en de aanwezige lettertypen; welke van DaxPro / DaxPro-Bold / DaxPro-Light / DaxPro-Medium ontbreken. `lettertypen.viaFontmappen` is `false` bij Gotenberg: de fontmappen van deze server gaan dan niet mee in de render en de kaart toont de families als "onbekend" in plaats van "ontbreekt". Voedt de statuskaart. |
| `POST /api/conversies/afbeeldingen` | bearer | Welke gekoppelde afbeeldingen (`E:\…` in de .docx) heeft de beeldbank op de server? Body `{ namen }` (max. 50, alleen bestandsnamen), antwoord `{ gevonden, ontbrekend }`. Leest alleen de index, geen bestanden. De app vraagt de gebruiker alleen om de map als hier iets ontbreekt. |
| `POST /api/conversies` | bearer | De conversie. Body `{ bestandsnaam, docxBase64, afbeeldingen? }` (eigen 35mb-parser vóór de generieke; `afbeeldingen` = `[{ bestandsnaam, base64 }]` uit de map van de gebruiker, max. 50), antwoord `{ bestandsnaam, aantalCheckboxen, pdfBase64, lettertypen: { gevraagd, inPdf, vervangen }, engine, duurMs, symbolenVervangen, ankersGeschat, vormenVerwijderd, afbeeldingenIngesloten, ontbrekendeAfbeeldingen }`. Fouten: `VALIDATION` 400/413, `CONVERSIE_ENGINE_ONBESCHIKBAAR` 503, `CONVERSIE_MISLUKT` 422, `CONVERSIE_TIMEOUT` 504, `CONVERSIE_DRUK` 503. |
| `GET /api/conversies` | `requireAdmin` | Het conversies-logboek (migratie 0003), server-side gepagineerd; metadata, nooit documentinhoud. |
| `GET /api/audit-log` | `requireAdmin` | Server-side gepagineerd logboek (`logAction`/`logActionZachtjes`). |
| `PUT /api/config/:key` | `requireAdmin` | Alleen `CONFIG_WHITELIST`-sleutels (fail-closed). |

`GET /api/_health` bevat daarnaast een `conversie`-blok (`engine`,
`libreofficeGevonden`, `lettertypeBestanden`, `vereisteLettertypenOntbreken`,
`viaFontmappen`),
alleen booleans/aantallen — zo is vóór het inloggen te zien of de server kan
renderen.

`CONFIG_WHITELIST` bepaalt zowel wat bewerkbaar is als wat `GET /api/data`
teruggeeft — de config-tabel bevat ook `MOTRAC_VERIFY_KEY` (fallback als de
env-var ontbreekt), en die hoort nooit bij een gebruiker te belanden.

### Offerte-conversie (het domein)

De keten, per upload, in `backend/lib/`:

1. **`docxVoorbewerking.js`** (port van `DocxPreprocessor.java`) — in
   `word/document.xml` + `header*.xml` + `footer*.xml` wordt elke
   `<w:sym w:font="Wingdings 2" w:char="F0A3"/>` een `<w:t>☐</w:t>`; alle
   andere zip-onderdelen gaan byte-voor-byte mee (`fflate`). Verzamelt ook de
   gevraagde lettertypen (`w:rFonts` in runs, docDefaults, gebruikte stijlen
   incl. `basedOn`-keten). **Alleen `w:ascii`/`w:hAnsi`, en alleen buiten
   `<w:pPr>`** — dat is precies wat zichtbare tekst kan zetten. `w:cs`
   (complex script) en `w:eastAsia` (CJK) zijn terugvallen die Word overal
   neerzet en die nooit gerenderd worden, en de `<w:rPr>` in `<w:pPr>` is de
   opmaak van de alineamarkering. Namen die daaruit kwamen belandden nooit in
   de PDF en werden daarna als "vervangen" gemeld terwijl er niets vervangen
   was (gemeten 2026-09-22 op een echte offerte: Arial, Consolas en
   Calibri-Bold uit `w:cs`, Times New Roman uit `w:eastAsia` en uit 62
   alineamarkeringen). Zie de regressietests in
   `test/docxVoorbewerking.test.js`.

   Vóór die vervanging haalt **`verborgenVormen.js`** de vormen weg die in
   Word volledig onder een dekkende vorm met hogere z-volgorde liggen.
   LibreOffice houdt die stapelvolgorde bij tekstvakken niet aan en tekent hun
   tekst bovenop andere achtergrondvormen (LO 24.2 én 26.8). Aanleiding
   (2026-09-24, `test_nieuwe_opmaak_26.docx`): onder de foto's en rode vlakken
   van de Oplossingen-pagina lag een oud technisch gegevensblad ("Truck data"
   / "Warehouse data", 136 vormen) dat in de PDF dwars over de pagina stond.
   Bewust smal: alleen ankers in dezelfde alinea, positie t.o.v. de pagina in
   beide richtingen, elk meetpunt (12×12) onder een dekkend deel — JPEG-foto
   of effen vulling zonder alfa, als rechthoek of recht pad. PNG, rotatie,
   gespiegelde paden en bogen tellen niet als dekkend. Weg gaat de hele
   `mc:AlternateContent` (anders valt LO terug op de VML in `mc:Fallback`).
   Het aantal komt terug als `vormenVerwijderd`. Tests in
   `test/verborgenVormen.test.js`.

   Daarna zet **`tekstvakStijl.js`** op elke alinea zonder `<w:pStyle>` binnen
   een `<w:txbxContent>` expliciet de standaard-alineastijl (in de sjablonen
   `Standaard` = DaxPro-Light). Word doet dat impliciet; LibreOffice geeft zo'n
   alinea de stijl "Frame contents", die van de docDefaults erft — en daar
   staat het thema-lettertype `minorHAnsi` = **Calibri**. Gemeten 2026-09-24
   (FODT-export): Calibri-tekst van 1.399 naar 715 tekens. De rest is ÉCHT
   Calibri, ook in Word: alinea's in stijl `Geenafstand` ("Geen afstand"),
   die niet op `Standaard` is gebaseerd en zelf geen lettertype zet (o.a.
   "MyLinde" en "Nacalculatie" op de leveringspagina's). Dat hoort in het
   sjabloon opgelost te worden, niet hier: de converter volgt Word. Tests in
   `test/tekstvakStijl.test.js`.

   En **`lettertypeNamen.js`** zet lettertypenamen om die LibreOffice niet als
   familie vindt, op basis van de fontbestanden van deze server
   (`lettertypeAliassen()` in `lettertypen.js`, daarom haalt `conversie.js` de
   lettertypen nu vóór de voorbewerking op). Aanleiding (2026-09-24): het
   document vraagt `DaxPro-Bold`, maar dat is alleen de PostScript-naam; voor
   fontconfig heet dat bestand familie "DaxPro", stijl Bold. LibreOffice viel
   terug op **NotoSans** ("Datum:", "Offerte:", "Telefoonnummer:", "John
   Mestrom"), terwijl de statuskaart "DaxPro-Bold aanwezig" meldde (die telt
   ook PostScript-namen) en de lettertype-vergelijking niets zag (de PDF had
   DaxPro-Bold al van `DaxPro` + vet elders). Nu: `DaxPro-Bold` → `DaxPro` +
   `<w:b/>`, in document/kop/voet én `styles.xml`/`numbering.xml`. Alleen
   PostScript-namen die geen familie zijn, en alleen snitten die DOCX kan vragen
   (Regular/Bold/Italic/Bold Italic). Nagebootst met DejaVuSans-Bold (zelfde
   opbouw): vóór regular-terugval, erna de Bold-snit. Tests in
   `test/lettertypeNamen.test.js`.

   Tot slot sluit **`gekoppeldeAfbeeldingen.js`** afbeeldingen in die de .docx
   alleen koppelt (`<a:blip r:link=…>` naar `file:///E:\…\AFBEELDINGEN CPQ\…`).
   De configurator kan ze niet insluiten (Mark, 2026-09-24) en op de CDN staan
   ze niet; de server zoekt ze op bestandsnaam in `/uploads/afbeeldingen` of
   `AFBEELDINGEN_DIR` (hoofdletterongevoelig, submappen tot 4 diep). Het pad
   uit het document opent nooit een bestand — alleen de naam is een sleutel in
   de index van die map. Gevonden: `word/media/gekoppeld-N.ext`, interne
   relatie, `r:link` → `r:embed`, content type erbij. Niet gevonden: in
   `ontbrekendeAfbeeldingen` van het antwoord en als waarschuwing in de app.
   `conversie.js` zoekt ze vóór de voorbewerking (`gekoppeldeAfbeeldingenInDocx`
   pakt alleen de `.rels` uit). Tests in `test/gekoppeldeAfbeeldingen.test.js`.

   **Aanvulling vanuit de browser** (Mark, 2026-09-24: "de gebruiker heeft
   toegang tot de E-schijf"). De server kan niet bij E:, en een webpagina mag
   niets van de schijf lezen dat de gebruiker niet zelf aanwijst. Daarom leest
   de app bij het kiezen van de .docx zelf de koppelingen uit
   (`frontend/src/lib/docxKoppelingen.ts`: een mini-zip-lezer op
   `DecompressionStream`, alleen de `.rels`), vraagt de beeldbank via
   `POST /api/conversies/afbeeldingen` wat hij heeft, en vraagt alleen bij een
   tekort om de map AFBEELDINGEN CPQ (`lib/afbeeldingenMap.ts`, File System
   Access API). Edge/Chrome onthouden die map in IndexedDB (`mit-ds-checkbox` →
   `mappen`), dus de volgende keer is het één klik op "Toestaan" of niets.
   Andere browsers: de losse bestanden kiezen. Alleen de benodigde bestanden
   gaan mee (`afbeeldingen` in de body). **De beeldbank blijft eerste keus**: een
   meegestuurde afbeelding telt alleen voor een naam die daar ontbrak
   (`vulAanMetMeegestuurd`). UI: `modules/conversie/GekoppeldeAfbeeldingen.tsx`
   + `useGekoppeldeAfbeeldingen.ts`. Getest in Chromium met een echte
   map-handle uit het Origin Private File System in plaats van de native
   kiezer (headless kan die niet tonen); de echte E-schijf in Edge nog niet.
2. **`docxNaarPdf.js`** (port van `DocxToPdfService.java`) — LibreOffice
   headless met per conversie een **eigen tijdelijk gebruikersprofiel**
   (`-env:UserInstallation`; anders weigert LO een tweede instantie en botsen
   de cluster-workers) waarin `user/fonts/` gevuld wordt met de bestanden uit
   `backend/fonts/` (+ `/uploads/fonts`, of `FONTS_DIR`). **Zo blijven DaxPro,
   DaxPro-Bold, DaxPro-Light en DaxPro-Medium in de PDF zonder
   systeeminstallatie** —
   gecontroleerd op 2026-09-21: LO leest die profielmap ook als fontconfig
   het lettertype niet kent. Tweede engine: `DOCX_PDF_ENGINE=gotenberg` +
   `GOTENBERG_URL` (externe LibreOffice-dienst) voor het geval LO niet op de
   fleet-server zelf kan.
3. **`pdfCheckboxAnkers.js`** (port van `PdfCheckboxService.java`) — posities
   van ☐ (U+2610) en U+F0A3 via `pdfjs-dist` (tekst-items in
   PDF-gebruikersruimte), daarna met `pdf-lib` per glyph `\cb_NNN\` in wit
   1pt Helvetica als échte tekst, rechterrand vlak vóór het vakje, op de
   basislijn. Globale teller in leesvolgorde, het zichtbare ☐ blijft staan,
   géén AcroForm — precies de afspraken met de Apex-kant uit de PoC
   (placement `right`, offset 0,0). De lettertype-vergelijking gebeurt op de
   PDF vóór het stempelen.
4. **`conversie.js`** (port van `UploadController.java`) — validatie
   (.docx, ≤ 25 MB, geldige zip), werkmap in `os.tmpdir()` die in `finally`
   verdwijnt, begrenzer van `CONVERSIE_MAX_GELIJKTIJDIG` (2) renders per
   worker, `LIBREOFFICE_TIMEOUT_SECONDEN` (120). `lettertypen.js` leest de
   familienamen uit de fontbestanden (name-tabel) voor de statuskaart.

**Bewuste keuzes bij de port (2026-09-21):**

- **Upload en PDF reizen als base64 in JSON.** `lib/api.ts` is beschermde
  fleet-basis en kent alleen JSON; multipart of een binaire download zou een
  tweede transportpad of een wijziging in dat bestand vergen. 25 MB .docx →
  ~34 MB body, eigen parser op `/api/conversies` (35mb) vóór de generieke
  256kb. Wil Mark ooit multipart, dan hoort dat fleet-breed in `api.ts`.
- **`backend/fonts/DejaVuSans.ttf` wordt meegeleverd** (Bitstream Vera-licentie):
  het levert het ☐-glyph. DaxPro en OpenSymbol hebben U+2610 niet; zonder een
  lettertype dat het wél heeft rendert LO een leeg blokje, staat er geen ☐ in
  de tekstlaag en vindt de PDF-stap nul checkboxen — stil. De DaxPro-bestanden
  zelf staan (nog) niet in het repo: licentie en aanlevering zijn aan Mark
  (zie `backend/fonts/README.md`).
- **Een ☐ in een kop- of voettekst krijgt per pagina een eigen anker** (de
  PDF-stap telt glyphs, niet XML-runs) — zoals in de Java-versie.
- **Elke uitkomst komt in het `conversies`-logboek** (ook mislukt, met
  foutcode), zonder documentinhoud; de PoC had geen logboek en noemde dat als
  beperking. Beheerder-only, net als het audit-logboek.
- **De frontend volgt het datalaag-patroon van `mit-salessupport`**:
  `lib/dataProvider.ts` (interface), `lib/apiDataProvider.ts`,
  `lib/mockDataProvider.ts` (`VITE_DATA_BACKEND=mock`), `context/DataContext.tsx`
  (binnen de ingelogde shell in `App.tsx`, niet in het beschermde `main.tsx`).
  Pagina's: `modules/conversie/ConversiePage.tsx` (statuskaart + upload +
  resultaat) en `modules/geschiedenis/GeschiedenisPage.tsx` (admin;
  `DataTable` + `KaartLijst` uit dezelfde celfuncties, `Pagination`).
  Domein-CSS met voorvoegsel `.offerte-` in `styles/app.css`.

**Uitbreiden** volgt hetzelfde patroon: route in `server.js` + migratie in
`backend/migrations/` (viercijferig, aansluitend, idempotent —
`test/migraties.test.js` bewaakt de reeks), een nieuwe admin-route in
`BEHEERDERROUTES` in `test/auth.test.js`, een nieuw runtime-bestand of -map in
`COPY_ENTRIES` van `scripts/build.mjs` (anders faalt `test/syntax.test.js`).
Breid de checkbox-detectie **niet** uit zonder de tests opnieuw tegen echte
Motrac-offertes te valideren: √ in de service-inclusies is geen checkbox.

### Rondleiding (`frontend/src/rondleiding/`, tab `/rondleiding`)

De ingebouwde uitleg voor nieuwe gebruikers, op verzoek van Mark (2026-09-22)
geport uit `motrac-toegangsbeheer/src/rondleiding/` — dat het op zijn beurt uit
`mit-salessupport` haalde, de eerste app van de vloot met een rondleiding. Een
schermvullende laag met één uitsnede rond het element van de huidige stap en
een tekstballon ernaast, die zichzelf langs de tabs navigeert. Dezelfde opbouw
als daar, vertaald naar TypeScript: `stappen.ts` (de stappen als DATA),
`opslag.ts` (localStorage), `positie.ts` (waar de ballon komt),
`RondleidingContext.tsx` (volgorde, rollen, navigatie), `Rondleiding.tsx`
(tekenen en meten), plus `RondleidingKaart.tsx` en `RondleidingPagina.tsx`.

**Het zit NIET in `@motrac/template-ui`, en dat is nagekeken (0.10.0), niet
aangenomen.** Wat het pakket wél levert en wat deze module dus gebruikt in
plaats van na te bouwen: `useFocusTrap` (Tab-trap, Escape, focus-teruggave —
DESIGN_SYSTEM.md daar eist dat elke app-eigen overlay die gebruikt), `Button`,
`Card`, `Checkbox`, `Hint`, `Icon`, `SectionLabel`, en de plek in de zijbalk
(`Tab.onderaan` + `alleenInMenu`). Bewust **geen tour-bibliotheek**
(react-joyride, driver.js): dat is de vloot-afspraak "geen bibliotheek per
app", en zo'n pakket brengt eigen kleuren, z-indexen en focusgedrag mee terwijl
alles hier op de tokens van het pakket hoort te staan.

Zes dingen die je niet ongemerkt moet omgooien:
- **De rondleiding is ROLBEWUST, en dat is de helft van de functie.** Een stap
  met `alleenAdmin: true` valt weg voor wie de rol `admin` niet heeft: een
  gewone gebruiker krijgt 7 stappen, een beheerder 9 (de serverstatuskaart en
  het conversielogboek erbij). De rol komt uit `session.role` — dezelfde
  afleiding die bepaalt of die twee schermen überhaupt gerenderd worden, dus
  een onbekende rol valt via AuthContext terug op `gebruiker` en krijgt vanzelf
  de korte rondleiding. Er is geen aparte regel voor.
- **Een anker telt pas als het ook echt een rechthoek op het scherm heeft**
  (`zichtbaarAnker()` in `Rondleiding.tsx`). Dat is geen voorzorg: `AppShell`
  rendert zowel de zijbalk als de tabbalk en verbergt er één van, dus
  `a[href="/converteren"]` levert op élke breedte twee treffers op waarvan er
  één 0x0 op positie 0,0 staat. Met een kale `querySelector` werd de uitsnede
  op een telefoon een vierkantje van twaalf pixels linksboven. Gemeten op 390,
  900 en 1440px.
- **Op een smal scherm plakt de ballon boven- OF onderaan** (`smalleZijde()` in
  `positie.ts`). Onderaan is de standaard, maar een anker in de onderste
  schermhelft — op een telefoon is dat de tabbalk, precies waar de
  navigatiestap naar wijst — gaat er anders volledig achter schuil. Gemeten op
  390px: anker op y 712-758 van 780, ballon op 528-768.
- **De stap "Wat je terugkrijgt" heeft BEWUST geen anker.** Het resultaatblok
  bestaat pas ná een echte conversie, en de overlay vangt onderweg elke klik af
  — er valt dus per definitie niets aan te wijzen. Een optionele stap zou bij
  vrijwel iedereen worden overgeslagen; een verplichte zou eerst anderhalve
  seconde naar een verduisterd scherm laten staren. Een gecentreerde kaart
  vertelt het gewoon.
- **Een stap die nog naar zijn anker zoekt toont GEEN tekst, alleen de
  verduistering** (`ankerStand` in `Rondleiding.tsx`). De stand hoort bij een
  STAP-id, want het effect dat hem bijwerkt draait ná het render van de nieuwe
  stap; zonder die koppeling erft een gecentreerde stap de uitsnede van de stap
  ervoor. Om dezelfde reden hangt de uitsnede aan `eigenStand === 'gevonden'`
  en niet alleen aan `ankerRect`. En `slaOver` gaat via een ref de zoeklus in,
  niet via de dependency-array: `afsluiten` in de context hangt aan
  `location.pathname`, dus die functie krijgt bij elke navigatie een nieuwe
  identiteit en het zoekeffect begon dan telkens opnieuw bij poging 0 — een
  optionele stap bleef hangen in plaats van over te slaan.
- **Ankers zijn `data-rondleiding`-attributen op ONZE eigen markup.** Nooit op
  een klasse van `@motrac/template-ui`: die markup mag bij een pakketupdate
  wijzigen en dan verdwijnt de uitleg stilletjes. Op een `<Button>` mag het
  attribuut rechtstreeks (die geeft onbekende props door aan de echte
  `<button>`); op `<Card>` juist NIET — die destructureert alleen
  `title`/`icon`/`action`/`children` en laat de rest vallen, dus daar hoort een
  wikkeldiv omheen. Een `a[href="/<tab>"]`-selector voor de navigatie mag ook,
  maar altijd als `optioneel`.

**`frontend/scripts/check-rondleiding.mjs` is de poort eromheen**, mee in
`npm run build`. Hij valt om als een stap geen NL- of EN-tekst heeft, als er
tekst is van een stap die niet meer bestaat, als een anker uit `stappen.ts`
nergens in de app staat (of andersom), of als een stap naar een route wijst die
geen tabpad in `App.tsx` is — dat laatste stuurt de catch-all-route door naar
`/converteren` en dan draait de rondleiding rond. In `mit-salessupport` is de
rondleiding twee keer stilletjes achtergebleven bij de app vóórdat daar zo'n
controle omheen kwam; een comment is geen poort. Wat een stap ZEGT blijft
mensenwerk.

De check leest `stappen.ts` als TEKST en zet het `STAPPEN`-literal om naar
JSON: de deploy-job draait Node 20 en die kan geen TypeScript importeren. Dat
stelt één eis aan dat bestand — elke stap is één plat object-literal met enkele
aanhalingstekens — en die staat daar als comment. Wijkt een regel af, dan valt
de check hard om (gecontroleerd met een template-literal en met een
ontbrekende stap); hij slaat nooit stilletjes een stap over.

Een stap toevoegen is dus: één regel in `stappen.ts`, twee sleutels in beide
`rondleiding.json`s, en zo nodig één `data-rondleiding` in het scherm.

**Voortgang staat in `localStorage` onder `mit-ds-checkbox-rondleiding`, per
gebruiker gescoped** (op `session.user.id`, want een e-mailadres kan wijzigen).
Geen kolom in de database: het is een voorkeur van één persoon op één apparaat,
en pc's in de binnendienst worden gedeeld — zonder scoping zou de tweede
medewerker op zo'n pc de rondleiding nooit te zien krijgen. Hij start één keer
vanzelf op `/converteren` voor wie hem nog nooit zag; wie hem afsloot of
uitzette krijgt hem nooit meer vanzelf. `RONDLEIDING_VERSIE` in `opslag.ts`
omhoog = iedereen ziet hem opnieuw.

## i18n

Twee talen (NL is de referentie, EN de vertaling) en drie namespaces:
`common`, `auth`, `rondleiding`. Elke namespace staat met de hand geregistreerd in
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
- `backend/test/docxVoorbewerking.test.js`, `verborgenVormen.test.js`,
  `tekstvakStijl.test.js`, `lettertypeNamen.test.js`, `gekoppeldeAfbeeldingen.test.js`,
  `pdfCheckboxAnkers.test.js`, `lettertypen.test.js` — ports van de Java-tests uit `esign_motrac` plus de
  lettertype-laag; pure logica, geen DB of LibreOffice (de test-PDF wordt met
  pdf-lib + DejaVu Sans gebouwd).
- `backend/test/conversie.test.js` — de conversie over de echte server:
  validatie, 401/403, statusroute, logboek, 400/413. Staat `soffice` op de
  machine, dan draait de hele render-keten (3 checkboxen incl. header, ankers
  in de tekstlaag, bestaand anker `\s2\` blijft); zo niet, dan controleert
  hij de 503 `CONVERSIE_ENGINE_ONBESCHIKBAAR` — bewust een tak en geen skip,
  want CI eist `# skipped 0`. **De GitHub-runner heeft geen LibreOffice**, dus
  CI test de render-keten nu niet; een `apt-get install libreoffice-writer`
  in `tests.yml` (beschermd bestand) zou dat oplossen — voorleggen aan Mark.
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
