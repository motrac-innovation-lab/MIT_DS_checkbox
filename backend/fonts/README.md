# Lettertypen voor de PDF-render

LibreOffice kan een offerte alleen in het juiste lettertype naar PDF zetten als
het fontbestand beschikbaar is. Op het serverpark installeren we niets
systeembreed: elke conversie krijgt een eigen, tijdelijk LibreOffice-profiel en
**elke `*.ttf`/`*.otf` uit deze map wordt daar in `user/fonts/` gekopieerd**
(zie `lib/lettertypen.js` en `lib/docxNaarPdf.js`). Geen root, geen fontconfig.

## Wat hier hoort te staan

| Bestand | Waarom |
|---|---|
| `DejaVuSans.ttf` (meegeleverd, licentie in `DejaVuSans-LICENSE.txt`) | Levert het zichtbare vakje ☐ (U+2610). DaxPro en OpenSymbol hebben dat teken niet; zonder een lettertype dat het wél heeft rendert LibreOffice een leeg blokje en vindt de PDF-stap geen enkele checkbox. |
| **`DaxPro*.ttf` / `*.otf` — nog aan te leveren door Mark** | De huisstijl-lettertypen van de offertes: DaxPro, DaxPro-Light en DaxPro-Medium. Zonder deze bestanden vervangt LibreOffice ze (meestal door DejaVu Sans) en verschuift de layout. |

De statuskaart in de app (en `GET /api/conversies/status`) toont welke van de
drie DaxPro-families gevonden zijn, op basis van de familienaam ín het
fontbestand — niet op de bestandsnaam. Na elke conversie vergelijkt de
backend de lettertypen uit het document met die in de PDF en meldt de
gebruiker welke zijn vervangen.

## Buiten git houden?

DaxPro is een commercieel lettertype (FontFont). Of de bestanden in dit
(privé-)repo mogen staan hangt van de licentie af — dat is aan Mark. Twee
alternatieven zonder git:

1. **Persistente opslag van het platform**: zet ze in `/uploads/fonts/` op de
   backend-applicatie (persistent storage aanzetten op het dashboard, daarna
   deployen). Die map wordt standaard óók gelezen.
2. **Eigen map**: zet `FONTS_DIR=/pad/naar/fonts` (komma-gescheiden voor
   meerdere mappen) in het Environment-paneel; dan gelden alléén die mappen.
