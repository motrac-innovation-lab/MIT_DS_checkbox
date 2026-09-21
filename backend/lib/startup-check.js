// Valideert bij het opstarten dat alle verplichte env-vars aanwezig zijn, en
// meldt in één keer PRECIES wat ontbreekt — i.p.v. losse, makkelijk te missen
// fouten verderop (een lege FRONTEND_ORIGIN laat CORS bijvoorbeeld stilzwijgend
// geen header zetten, wat de browser alleen als vage "Failed to fetch"/
// CORS-fout toont; een ontbrekende DATABASE_URL crasht met een rauwe
// stacktrace). Voor het platform waarop dit draait (alleen bestanden
// uploaden, geen shell-toegang) is dat te traag te debuggen uit logoutput
// alleen — dus meteen bij opstarten, in één duidelijke melding.
const REQUIRED = ['DATABASE_URL', 'FRONTEND_ORIGIN', 'MOTRAC_BEHEER_URL']

export const missingEnv = REQUIRED.filter((key) => !process.env[key]?.trim())

if (missingEnv.length) {
  console.error('='.repeat(70))
  console.error('KAN NIET STARTEN — verplichte env-var(s) ontbreken in .env:')
  for (const key of missingEnv) console.error(`  - ${key}`)
  console.error('')
  console.error('Zet backend/.env neer naast server.js (zie backend/.env.example')
  console.error('voor het volledige sjabloon, en DEPLOY.md voor de deploy-stappen).')
  console.error('Let op: .env staat in .gitignore en wordt dus NIET automatisch')
  console.error('meegenomen bij het uploaden van de broncode — bij elke verse')
  console.error('upload/wipe van de backend-map moet dit bestand opnieuw')
  console.error('handmatig neergezet worden.')
  console.error('Op het deploy-platform horen deze in het Environment-paneel van')
  console.error('de applicatie te staan, NIET in een .env op de server: de deploy')
  console.error('vervangt de hele map, dus een los .env-bestand daar verdwijnt bij')
  console.error('elke deploy.')
  console.error('='.repeat(70))
}

// Bewust GEEN process.exit(1) meer hier. Op dit platform is een proces dat
// direct stopt onzichtbaar: de cluster-wrapper herstart hem zonder backoff en
// van buiten zie je alleen een kale 502/503 van de reverse proxy, zonder
// CORS-headers — wat de browser bovendien als een misleidende CORS-fout toont.
// server.js opent nu in plaats daarvan de poort in storingsmodus en meldt de
// oorzaak op /api/_health, zodat te zien is wát er ontbreekt zonder logtoegang.
