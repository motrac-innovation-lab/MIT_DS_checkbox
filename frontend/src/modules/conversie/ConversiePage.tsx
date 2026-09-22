import { useCallback, useEffect, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Card, Field, Hint, Input, Progress, StatGrid, Tag, biedBestandAan } from '@motrac/template-ui'
import { useData } from '../../context/DataContext'
import { ApiError } from '../../lib/api'
import { base64NaarBlob, leesBestandAlsBase64, leesbareGrootte } from '../../lib/bestanden'
import type { ConversieResultaat, ConversieStatus } from '../../types'

/**
 * De ene functie van de app, geport uit `esign_motrac` (upload.html +
 * result.html): kies een .docx uit de configurator, converteer, download de
 * PDF met de verborgen DocuSign-ankers. Daarbovenop wat de PoC niet had: een
 * statuskaart die vóór het uploaden zegt of de server kan renderen en of de
 * DaxPro-lettertypen aanwezig zijn, en per conversie de lettertype-controle.
 *
 * Paginakop: `.page-head > h1.page-h` — de norm uit docs/UI-UX-PLAN-PER-APP.md.
 * Formulierveld: Input uit het pakket binnen een Field (a11y-koppeling), de
 * dropzone eromheen is domein-CSS (`.offerte-dropzone` in styles/app.css).
 */
export function ConversiePage() {
  const { t, i18n } = useTranslation('common')
  const data = useData()
  const taal = i18n.resolvedLanguage ?? i18n.language

  const [status, setStatus] = useState<ConversieStatus | null>(null)
  const [statusFout, setStatusFout] = useState<string | null>(null)
  const [bestand, setBestand] = useState<File | null>(null)
  const [sleept, setSleept] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<{ code: string; message: string } | null>(null)
  const [resultaat, setResultaat] = useState<ConversieResultaat | null>(null)
  // Input uit het pakket geeft geen ref door; een nieuwe key hermount het
  // veld en maakt zo de gekozen bestandsnaam leeg bij "Nieuw document".
  const [invoerSleutel, setInvoerSleutel] = useState(0)

  const laadStatus = useCallback(async () => {
    setStatusFout(null)
    try {
      setStatus(await data.conversieStatus())
    } catch (e) {
      setStatusFout(e instanceof ApiError ? e.message : t('algemeen.ladenMislukt'))
    }
  }, [data, t])

  useEffect(() => {
    void laadStatus()
  }, [laadStatus])

  function kies(nieuw: File | null) {
    setFout(null)
    setResultaat(null)
    if (!nieuw) {
      setBestand(null)
      return
    }
    if (!/\.docx$/i.test(nieuw.name)) {
      setBestand(null)
      setFout({ code: 'VALIDATION', message: t('conversie.fout.geenDocx') })
      return
    }
    if (status && nieuw.size > status.maxDocxBytes) {
      setBestand(null)
      setFout({ code: 'VALIDATION', message: t('conversie.fout.teGroot', { max: leesbareGrootte(status.maxDocxBytes, taal) }) })
      return
    }
    setBestand(nieuw)
  }

  function onInvoer(e: ChangeEvent<HTMLInputElement>) {
    kies(e.target.files?.[0] ?? null)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setSleept(false)
    kies(e.dataTransfer.files?.[0] ?? null)
  }

  function download(r: ConversieResultaat) {
    biedBestandAan(base64NaarBlob(r.pdfBase64, 'application/pdf'), r.bestandsnaam)
  }

  async function converteer(e: FormEvent) {
    e.preventDefault()
    if (!bestand || bezig) return
    setBezig(true)
    setFout(null)
    setResultaat(null)
    try {
      const r = await data.converteer(bestand.name, await leesBestandAlsBase64(bestand))
      setResultaat(r)
      // Meteen aanbieden — dat was in de PoC een extra klik; de knop hieronder
      // blijft voor een tweede download.
      download(r)
    } catch (err) {
      if (err instanceof ApiError) setFout({ code: err.code, message: err.message })
      else setFout({ code: 'UNKNOWN', message: t('conversie.fout.onbekend') })
    } finally {
      setBezig(false)
    }
  }

  function opnieuw() {
    setBestand(null)
    setResultaat(null)
    setFout(null)
    setInvoerSleutel((k) => k + 1)
  }

  const serverKlaar = status?.beschikbaar ?? false
  // Bij een externe engine (Gotenberg) gaan de fontbestanden van deze server
  // niet mee in de render: dan is "ontbreekt" geen uitspraak over de PDF en
  // tonen we de vereiste families als "onbekend" — het resultaatblok meldt
  // per conversie welke lettertypen echt vervangen zijn.
  const viaFontmappen = status?.lettertypen.viaFontmappen ?? true
  const ontbrekendeFonts = viaFontmappen ? (status?.lettertypen.ontbreekt ?? []) : []
  const vereist = status?.lettertypen.vereist ?? []
  const sleutel = (naam: string) => naam.replace(/[^a-z0-9]/gi, '').toLowerCase()
  // Extra families op de server die geen vereist lettertype zijn (bv. DejaVu Sans voor het ☐).
  const overigeFamilies = (viaFontmappen ? status?.lettertypen.bestanden.flatMap((b) => b.families) ?? [] : [])
    .filter((f, i, alle) => alle.indexOf(f) === i && !vereist.some((v) => sleutel(v) === sleutel(f)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-head">
        <h1 className="page-h">{t('conversie.titel')}</h1>
      </div>

      <Card title={t('conversie.status.titel')} icon="shield-check">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {statusFout && (
            <Alert tone="bad" actie={<Button small variant="ghost" onClick={laadStatus}>{t('algemeen.opnieuwProberen')}</Button>}>
              {statusFout}
            </Alert>
          )}
          {!status && !statusFout && <Hint>{t('algemeen.gegevensLaden')}</Hint>}
          {status && !status.beschikbaar && (
            <Alert tone="bad" titel={t('conversie.status.engineOntbreektTitel')}>
              {t('conversie.status.engineOntbreekt', { engine: status.engine })}
            </Alert>
          )}
          {status && status.beschikbaar && (
            <Hint>
              {status.libreoffice?.versie
                ? t('conversie.status.gereedMetVersie', { versie: status.libreoffice.versie })
                : t('conversie.status.gereed', { engine: status.engine })}
            </Hint>
          )}
          {status && (
            <div className="offerte-lettertypen" aria-label={t('conversie.status.lettertypen')}>
              {vereist.map((naam) => (
                <Tag key={naam} tone={!viaFontmappen ? 'neutral' : ontbrekendeFonts.includes(naam) ? 'warn' : 'ok'}>
                  {naam}
                  {!viaFontmappen
                    ? ` · ${t('conversie.status.onbekend')}`
                    : ontbrekendeFonts.includes(naam) ? ` · ${t('conversie.status.ontbreekt')}` : ''}
                </Tag>
              ))}
              {overigeFamilies.map((f) => (
                <Tag key={f} tone="neutral">{f}</Tag>
              ))}
            </div>
          )}
          {status && !viaFontmappen && (
            <Hint>{t('conversie.status.fontsExtern', { engine: status.engine })}</Hint>
          )}
          {ontbrekendeFonts.length > 0 && (
            <Alert tone="warn" titel={t('conversie.status.fontsOntbrekenTitel')}>
              {t('conversie.status.fontsOntbreken', { fonts: ontbrekendeFonts.join(', ') })}
            </Alert>
          )}
        </div>
      </Card>

      <Card title={t('conversie.upload.titel')} icon="file-text">
        <form onSubmit={converteer} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            className={sleept ? 'offerte-dropzone offerte-dropzone-actief' : 'offerte-dropzone'}
            onDragOver={(e) => { e.preventDefault(); setSleept(true) }}
            onDragLeave={() => setSleept(false)}
            onDrop={onDrop}
          >
            <Field label={t('conversie.upload.veld')} hint={t('conversie.upload.hint')}>
              <Input
                key={invoerSleutel}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={onInvoer}
                disabled={bezig}
              />
            </Field>
            {bestand && (
              <p className="hint offerte-bestand">
                {t('conversie.upload.gekozen', { naam: bestand.name, grootte: leesbareGrootte(bestand.size, taal) })}
              </p>
            )}
          </div>

          {fout && (
            <Alert tone="bad" titel={t('conversie.fout.titel')}>
              {fout.message}
              {fout.code === 'CONVERSIE_ENGINE_ONBESCHIKBAAR' && ` ${t('conversie.fout.engineHint')}`}
            </Alert>
          )}

          {bezig && <Progress label={t('conversie.bezig')} />}

          <div className="offerte-acties">
            <Button variant="primary" type="submit" disabled={!bestand || bezig || !serverKlaar}>
              {bezig ? t('conversie.bezig') : t('conversie.knop')}
            </Button>
            {(bestand || resultaat) && !bezig && (
              <Button variant="ghost" type="button" onClick={opnieuw}>{t('conversie.nieuw')}</Button>
            )}
          </div>
        </form>
      </Card>

      {resultaat && (
        <Card title={t('conversie.resultaat.titel')} icon="check-circle">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <StatGrid
              stats={[
                { value: resultaat.aantalCheckboxen, label: t('conversie.resultaat.checkboxen'), tone: resultaat.aantalCheckboxen > 0 ? 'ok' : 'warn' },
                { value: `${(resultaat.duurMs / 1000).toLocaleString(taal, { maximumFractionDigits: 1 })} s`, label: t('conversie.resultaat.duur') },
                { value: resultaat.symbolenVervangen, label: t('conversie.resultaat.symbolen'), sub: t('conversie.resultaat.symbolenSub') },
              ]}
            />
            {resultaat.aantalCheckboxen === 0 && (
              <Alert tone="warn">{t('conversie.resultaat.geenCheckboxen')}</Alert>
            )}
            {resultaat.ankersGeschat > 0 && (
              <Alert tone="warn">{t('conversie.resultaat.geschat', { aantal: resultaat.ankersGeschat })}</Alert>
            )}
            <div>
              <p className="hint" style={{ marginBottom: 6 }}>{t('conversie.resultaat.lettertypen')}</p>
              <div className="offerte-lettertypen">
                {resultaat.lettertypen.gevraagd.length === 0 && <Tag tone="neutral">{t('conversie.resultaat.geenLettertypen')}</Tag>}
                {resultaat.lettertypen.gevraagd.map((naam) => (
                  <Tag key={naam} tone={resultaat.lettertypen.vervangen.includes(naam) ? 'warn' : 'ok'}>
                    {naam}
                    {resultaat.lettertypen.vervangen.includes(naam) ? ` · ${t('conversie.resultaat.vervangen')}` : ''}
                  </Tag>
                ))}
              </div>
            </div>
            {resultaat.lettertypen.vervangen.length > 0 && (
              <Alert tone="warn" titel={t('conversie.resultaat.vervangenTitel')}>
                {t('conversie.resultaat.vervangenTekst', { fonts: resultaat.lettertypen.vervangen.join(', ') })}
              </Alert>
            )}
            <div className="offerte-acties">
              <Button variant="primary" type="button" onClick={() => download(resultaat)}>
                {t('conversie.resultaat.download', { naam: resultaat.bestandsnaam })}
              </Button>
              <Button variant="ghost" type="button" onClick={opnieuw}>{t('conversie.nieuw')}</Button>
            </div>
            <Hint>{t('conversie.resultaat.apexHint')}</Hint>
          </div>
        </Card>
      )}
    </div>
  )
}
