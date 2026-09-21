-- Sales offerte converter — initieel Postgres-schema.
-- Vers fleet-scaffold: geen domeintabellen, alleen de generieke
-- key/value-config die server.js gebruikt als MOTRAC_VERIFY_KEY-fallback
-- wanneer die niet als env-var is gezet (zie getVerifyKey() in server.js).
--
-- IF NOT EXISTS op de CREATE TABLE: server.js past dit bestand bij élke boot
-- toe (zelf-migrerend, zie lib/migrate.js), dus dit moet herhaaldelijk zonder
-- fouten kunnen draaien tegen een al-gemigreerde database.

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
