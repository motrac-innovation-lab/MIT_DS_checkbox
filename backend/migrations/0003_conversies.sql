-- Logboek van uitgevoerde offerte-conversies (DOCX → PDF met DocuSign-ankers).
-- Alleen metadata: wie, wanneer, welk bestand, hoeveel checkboxen, hoe lang,
-- en of LibreOffice een lettertype heeft vervangen. NOOIT de inhoud van het
-- document — offertes zijn commercieel materiaal en blijven niet op de server.
--
-- De PoC (esign_motrac) had dit niet ("geen audit log, geen persistente
-- opslag") en daar was het ontbreken ervan een bekende beperking. Mislukte
-- conversies staan er ook in (status 'mislukt' + foutcode), zodat een
-- beheerder ziet óf en waarom het misgaat zonder de serverlog te hoeven lezen.
--
-- Idempotent (IF NOT EXISTS): draait bij elke boot opnieuw, zie lib/migrate.js.
CREATE TABLE IF NOT EXISTS conversies (
  id BIGSERIAL PRIMARY KEY,
  aangemaakt_op TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_naam TEXT NOT NULL,
  actor_email TEXT,
  bestandsnaam TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('geslaagd', 'mislukt')),
  aantal_checkboxen INTEGER,
  duur_ms INTEGER,
  engine TEXT,
  -- JSON-array met de lettertypen die het document vroeg maar die niet in de
  -- PDF terechtkwamen. Als tekst (JSON) en niet als TEXT[]: de db.js-shim
  -- bindt parameters als tekst, en zo blijft de kolom overal even leesbaar.
  lettertypen_vervangen TEXT NOT NULL DEFAULT '[]',
  foutcode TEXT,
  foutmelding TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversies_aangemaakt_op ON conversies(aangemaakt_op DESC);
