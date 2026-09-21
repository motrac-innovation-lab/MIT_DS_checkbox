-- Logboek van beheer-handelingen (elke geslaagde muterende actie). Vers
-- fleet-scaffold: nog geen enkele muterende route die hier iets in schrijft,
-- maar de tabel + logAction() + GET /api/audit-log bestaan al zodat een
-- toekomstige feature meteen kan loggen zonder eerst een migratie te
-- schrijven. aangemaakt_op is een echte TIMESTAMPTZ: dit logboek sorteert op
-- tijd en kan meerdere regels per dag hebben.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  aangemaakt_op TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_naam TEXT NOT NULL,
  actor_email TEXT,
  actie TEXT NOT NULL,
  omschrijving TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_aangemaakt_op ON audit_log(aangemaakt_op DESC);
