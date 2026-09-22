# Lettertypen voor de PDF-render

LibreOffice kan een offerte alleen in het juiste lettertype naar PDF zetten als
het fontbestand beschikbaar is. Op het serverpark installeren we niets
systeembreed: elke conversie krijgt een eigen, tijdelijk LibreOffice-profiel en
**elke `*.ttf`/`*.otf` uit deze map wordt daar in `user/fonts/` gekopieerd**
(zie `lib/lettertypen.js` en `lib/docxNaarPdf.js`). Geen root, geen fontconfig.

> **Alleen bij de lokale engine (`DOCX_PDF_ENGINE=soffice`, de standaard).**
> Bij `DOCX_PDF_ENGINE=gotenberg` gaat enkel de `.docx` naar de externe
> LibreOffice-dienst en komen de lettertypen uit de image van die dienst
> (`COPY fonts/ /usr/local/share/fonts/`, zie DEPLOY.md route B). Deze map,
> `/uploads/fonts/` en `FONTS_DIR` hebben dan geen invloed op de PDF; de
> statuskaart toont de DaxPro-families dan als "onbekend" en pas het resultaat
> van een conversie meldt welke lettertypen echt vervangen zijn.

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
