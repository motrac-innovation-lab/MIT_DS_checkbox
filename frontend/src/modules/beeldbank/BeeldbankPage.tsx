import { useCallback, useEffect, useState, type InputHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  ConfirmModal,
  DataTable,
  Field,
  Hint,
  Input,
  KaartLijst,
  Pagination,
  Progress,
  SkeletonText,
  Tag,
  useKaartWeergave,
  type Column,
  type KaartItem,
  type Sortering,
} from '@motrac/template-ui'
import { useData } from '../../context/DataContext'
import { ApiError } from '../../lib/api'
import { leesbareGrootte } from '../../lib/bestanden'
import type { BeeldbankItem, BeeldbankLijst } from '../../types'
import { MAX_BEELD_BYTES, useBeeldbankUpload } from './useBeeldbankUpload'

const PAGINA_GROOTTE = 25
const ACCEPT = '.png,.jpg,.jpeg,.gif,.bmp,.tif,.tiff,.emf,.wmf,.svg,image/*'
// Een map kiezen i.p.v. losse bestanden. Staat niet in React's typen, maar
// alle huidige browsers (ook Firefox en Safari) kennen het attribuut; Input
// geeft het door aan de echte <input>.
const MAP_KIEZEN = { webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>

/**
 * De beeldbank (beheerder): de afbeeldingen die de server gebruikt voor
 * afbeeldingen die een offerte alleen koppelt (E:\…\AFBEELDINGEN CPQ). Eén
 * keer de hele map als batch, daarna per nieuw product losse bestanden — beide
 * via hetzelfde uploadblok. Wat al met dezelfde naam en grootte op de server
 * staat, wordt standaard overgeslagen, zodat een batch opnieuw draaien alleen
 * de nieuwe en gewijzigde foto's verstuurt.
 */
export function BeeldbankPage() {
  const { t, i18n } = useTranslation('common')
  const data = useData()
  const kaarten = useKaartWeergave()
  const taal = i18n.resolvedLanguage === 'en' ? 'en-GB' : 'nl-NL'

  const [zoekInvoer, setZoekInvoer] = useState('')
  const [zoek, setZoek] = useState('')
  const [pagina, setPagina] = useState(1)
  const [lijst, setLijst] = useState<BeeldbankLijst | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [laden, setLaden] = useState(true)
  const [teVerwijderen, setTeVerwijderen] = useState<BeeldbankItem | null>(null)
  const [ookOngewijzigd, setOokOngewijzigd] = useState(false)
  const [invoerSleutel, setInvoerSleutel] = useState(0)

  // Zoeken met een korte pauze, en altijd terug naar pagina 1.
  useEffect(() => {
    const timer = setTimeout(() => {
      setZoek(zoekInvoer.trim())
      setPagina(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [zoekInvoer])

  const laad = useCallback(async () => {
    setLaden(true)
    setFout(null)
    try {
      setLijst(await data.beeldbankLijst(zoek, pagina, PAGINA_GROOTTE))
    } catch (e) {
      setFout(e instanceof ApiError ? e.message : t('algemeen.ladenMislukt'))
    } finally {
      setLaden(false)
    }
  }, [data, zoek, pagina, t])

  useEffect(() => {
    void laad()
  }, [laad])

  const upload = useBeeldbankUpload(laad)
  const { selectie, voortgang, uitkomst } = upload
  // Na een upload of annuleren de bestandsvelden leegmaken, zodat dezelfde map
  // nog eens kiezen weer een change-event geeft.
  const leegVelden = () => setInvoerSleutel((n) => n + 1)

  const opslag = lijst?.opslag
  const geenOpslag = opslag ? !opslag.kanAanmaken : false
  const uitgeschakeld = upload.bezig || geenOpslag

  const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleString(taal, { dateStyle: 'medium', timeStyle: 'short' }) : '—')
  const grootte = (b: number | null) => (b == null ? '—' : leesbareGrootte(b, taal))
  const verwijderKnop = (r: BeeldbankItem) => (
    <Button small variant="ghost" type="button" onClick={() => setTeVerwijderen(r)} disabled={r.alleenLezen || upload.bezig}>
      {t('beeldbank.verwijderen')}
    </Button>
  )
  const naamCel = (r: BeeldbankItem) => (
    <span className="offerte-lettertypen">
      <span className="mono">{r.naam}</span>
      {r.alleenLezen && <Tag tone="neutral">{t('beeldbank.alleenLezen')}</Tag>}
    </span>
  )

  const kolommen: Column<BeeldbankItem>[] = [
    { key: 'naam', header: t('beeldbank.kolom.naam'), value: (r) => r.naam, render: naamCel },
    { key: 'submap', header: t('beeldbank.kolom.submap'), value: (r) => r.submap ?? '', render: (r) => r.submap ?? '—' },
    { key: 'grootte', header: t('beeldbank.kolom.grootte'), value: (r) => r.grootte ?? undefined, align: 'right', mono: true, render: (r) => grootte(r.grootte) },
    { key: 'gewijzigd', header: t('beeldbank.kolom.gewijzigd'), value: (r) => r.gewijzigdOp ?? '', render: (r) => <span className="mono">{datum(r.gewijzigdOp)}</span> },
    { key: 'actie', header: '', value: () => '', sorteerbaar: false, align: 'right', render: verwijderKnop },
  ]

  const kaartVan = (r: BeeldbankItem): KaartItem => ({
    id: r.naam,
    kop: r.naam,
    subtitel: `${grootte(r.grootte)} · ${datum(r.gewijzigdOp)}`,
    merken: r.alleenLezen ? <Tag tone="neutral">{t('beeldbank.alleenLezen')}</Tag> : undefined,
    velden: [
      { label: t('beeldbank.kolom.submap'), inhoud: r.submap, verbergen: !r.submap },
      { label: '', inhoud: verwijderKnop(r), breed: true },
    ],
  })

  const aantalPaginas = lijst ? Math.max(1, Math.ceil(lijst.totaal / PAGINA_GROOTTE)) : 1
  // De server sorteert al op naam; een eigen sortering zou alleen de zichtbare
  // rijen herschikken (zie de docblock van DataTable).
  const sortering: Sortering = { key: 'naam', richting: 'asc' }

  const teSturen = selectie
    ? selectie.vergelijking.nieuw.length + selectie.vergelijking.gewijzigd.length + (ookOngewijzigd ? selectie.vergelijking.gelijk.length : 0)
    : 0
  const vervangen = uitkomst?.opgeslagen.filter((o) => o.vervangen).length ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-head">
        <h1 className="page-h">{t('beeldbank.titel')}</h1>
      </div>

      <div data-rondleiding="beeldbank-upload">
        <Card title={t('beeldbank.upload.titel')} icon="upload">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Hint>{t('beeldbank.upload.uitleg', { max: leesbareGrootte(MAX_BEELD_BYTES, taal) })}</Hint>
            {geenOpslag && opslag && (
              <Alert tone="bad" titel={t('beeldbank.opslag.geenTitel')}>
                {t('beeldbank.opslag.geenTekst', { map: opslag.map })}
              </Alert>
            )}
            <div key={invoerSleutel} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field label={t('beeldbank.upload.mapVeld')} hint={t('beeldbank.upload.mapHint')}>
                <Input type="file" {...MAP_KIEZEN} multiple onChange={(e) => void upload.kies(e.target.files)} disabled={uitgeschakeld} />
              </Field>
              <Field label={t('beeldbank.upload.bestandenVeld')} hint={t('beeldbank.upload.bestandenHint')}>
                <Input type="file" multiple accept={ACCEPT} onChange={(e) => void upload.kies(e.target.files)} disabled={uitgeschakeld} />
              </Field>
            </div>

            {upload.bezig && !voortgang && <Hint>{t('beeldbank.upload.vergelijken')}</Hint>}

            {selectie && !voortgang && (
              <Alert tone={teSturen ? 'neutral' : 'ok'} titel={t('beeldbank.selectie.titel', { aantal: selectie.bestanden.length })}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="offerte-lettertypen">
                    <Tag tone="neutral">{t('beeldbank.selectie.nieuw', { aantal: selectie.vergelijking.nieuw.length })}</Tag>
                    <Tag tone="warn">{t('beeldbank.selectie.gewijzigd', { aantal: selectie.vergelijking.gewijzigd.length })}</Tag>
                    <Tag tone="ok">{t('beeldbank.selectie.gelijk', { aantal: selectie.vergelijking.gelijk.length })}</Tag>
                  </div>
                  {selectie.overgeslagen > 0 && <span>{t('beeldbank.selectie.overgeslagen', { aantal: selectie.overgeslagen })}</span>}
                  {selectie.teGroot.length > 0 && <span>{t('beeldbank.selectie.teGroot', { namen: selectie.teGroot.join(', ') })}</span>}
                  {selectie.dubbel.length > 0 && <span>{t('beeldbank.selectie.dubbel', { namen: selectie.dubbel.slice(0, 10).join(', '), aantal: selectie.dubbel.length })}</span>}
                  {selectie.vergelijking.gelijk.length > 0 && (
                    <Checkbox
                      label={t('beeldbank.selectie.ookOngewijzigd')}
                      checked={ookOngewijzigd}
                      onChange={(e) => setOokOngewijzigd(e.target.checked)}
                    />
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button type="button" onClick={() => void upload.upload(ookOngewijzigd).then(leegVelden)} disabled={!teSturen || uitgeschakeld}>
                      {t('beeldbank.selectie.uploaden', { aantal: teSturen })}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => { upload.wis(); leegVelden() }} disabled={upload.bezig}>
                      {t('beeldbank.selectie.annuleren')}
                    </Button>
                  </div>
                </div>
              </Alert>
            )}

            {voortgang && (
              <Progress
                waarde={voortgang.klaar}
                max={Math.max(1, voortgang.totaal)}
                label={t('beeldbank.upload.bezig', { klaar: voortgang.klaar, totaal: voortgang.totaal })}
              />
            )}

            {upload.fout && <Alert tone="bad">{upload.fout}</Alert>}

            {uitkomst && (uitkomst.opgeslagen.length > 0 || uitkomst.geweigerd.length > 0) && (
              <Alert
                tone={uitkomst.geweigerd.length ? 'warn' : 'ok'}
                titel={t('beeldbank.uitkomst.titel', { aantal: uitkomst.opgeslagen.length, vervangen })}
              >
                {uitkomst.geweigerd.length === 0 && t('beeldbank.uitkomst.klaar')}
                {uitkomst.geweigerd.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span>{t('beeldbank.uitkomst.geweigerd', { aantal: uitkomst.geweigerd.length })}</span>
                    <div className="offerte-lettertypen">
                      {uitkomst.geweigerd.map((g) => (
                        <Tag key={g.naam} tone="bad">{g.naam} · {t(`beeldbank.reden.${g.reden}`)}</Tag>
                      ))}
                    </div>
                  </div>
                )}
              </Alert>
            )}
          </div>
        </Card>
      </div>

      <div>
        <Card title={t('beeldbank.lijst.titel')} icon="images">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label={t('beeldbank.lijst.zoekVeld')}>
              <Input type="search" value={zoekInvoer} onChange={(e) => setZoekInvoer(e.target.value)} placeholder={t('beeldbank.lijst.zoekPlaceholder')} />
            </Field>
            {fout && (
              <Alert tone="bad" actie={<Button small variant="ghost" onClick={laad}>{t('algemeen.opnieuwProberen')}</Button>}>
                {fout}
              </Alert>
            )}
            {laden && !lijst && <SkeletonText regels={4} />}
            {lijst && (
              <>
                <Hint>
                  {zoek ? t('beeldbank.lijst.aantalGezocht', { aantal: lijst.totaal }) : t('beeldbank.lijst.aantal', { aantal: lijst.totaal })}
                  {opslag?.bestaat && <> · <span className="mono">{opslag.map}</span></>}
                </Hint>
                {kaarten ? (
                  <KaartLijst items={lijst.items.map(kaartVan)} leeg={zoek ? t('beeldbank.lijst.geenTreffers') : t('beeldbank.lijst.leeg')} />
                ) : (
                  <DataTable
                    columns={kolommen}
                    rows={lijst.items}
                    rowKey={(r) => r.naam}
                    empty={zoek ? t('beeldbank.lijst.geenTreffers') : t('beeldbank.lijst.leeg')}
                    sortering={sortering}
                    onSorteer={() => undefined}
                  />
                )}
                <Pagination pagina={pagina} aantalPaginas={aantalPaginas} onWissel={setPagina} />
              </>
            )}
          </div>
        </Card>
      </div>

      {teVerwijderen && (
        <ConfirmModal
          title={t('beeldbank.verwijderTitel')}
          message={t('beeldbank.verwijderTekst', { naam: teVerwijderen.naam })}
          onConfirm={async () => {
            await data.beeldbankVerwijder(teVerwijderen.naam)
            await laad()
          }}
          onClose={() => setTeVerwijderen(null)}
        />
      )}
    </div>
  )
}
