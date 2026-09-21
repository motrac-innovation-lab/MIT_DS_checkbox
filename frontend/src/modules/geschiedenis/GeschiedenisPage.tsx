import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Button,
  Card,
  DataTable,
  Hint,
  KaartLijst,
  Pagination,
  SkeletonText,
  Tag,
  useKaartWeergave,
  type Column,
  type KaartItem,
  type Sortering,
} from '@motrac/template-ui'
import { useData } from '../../context/DataContext'
import { ApiError } from '../../lib/api'
import type { ConversieRegel, Pagina } from '../../types'

const PAGINA_GROOTTE = 20

/**
 * Het conversies-logboek (beheerder): wie zette wanneer welk bestand om, met
 * hoeveel checkboxen, en of LibreOffice een lettertype verving. Metadata
 * alleen — de documenten zelf blijven nergens bewaard.
 *
 * Tabel én kaartweergave uit dezelfde celfuncties (norm §1.1): onder Q_KAART
 * één renderkeuze via useKaartWeergave(), nooit twee DOM-bomen.
 */
export function GeschiedenisPage() {
  const { t, i18n } = useTranslation('common')
  const data = useData()
  const kaarten = useKaartWeergave()
  const taal = i18n.resolvedLanguage === 'en' ? 'en-GB' : 'nl-NL'

  const [pagina, setPagina] = useState(1)
  const [lijst, setLijst] = useState<Pagina<ConversieRegel> | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [laden, setLaden] = useState(true)

  const laad = useCallback(async () => {
    setLaden(true)
    setFout(null)
    try {
      setLijst(await data.conversies(pagina, PAGINA_GROOTTE))
    } catch (e) {
      setFout(e instanceof ApiError ? e.message : t('algemeen.ladenMislukt'))
    } finally {
      setLaden(false)
    }
  }, [data, pagina, t])

  useEffect(() => {
    void laad()
  }, [laad])

  const datum = (iso: string) => new Date(iso).toLocaleString(taal, { dateStyle: 'medium', timeStyle: 'short' })
  const duur = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toLocaleString(taal, { maximumFractionDigits: 1 })} s`)
  const statusTag = (r: ConversieRegel) => (
    <Tag tone={r.status === 'geslaagd' ? 'ok' : 'bad'}>{t(`geschiedenis.status.${r.status}`)}</Tag>
  )
  const lettertypenCel = (r: ConversieRegel) =>
    r.lettertypenVervangen.length === 0 ? (
      <span className="hint">{t('geschiedenis.geenVervangen')}</span>
    ) : (
      <span className="offerte-lettertypen">
        {r.lettertypenVervangen.map((f) => <Tag key={f} tone="warn">{f}</Tag>)}
      </span>
    )

  const kolommen: Column<ConversieRegel>[] = [
    { key: 'datum', header: t('geschiedenis.kolom.datum'), value: (r) => r.aangemaaktOp, render: (r) => <span className="mono">{datum(r.aangemaaktOp)}</span> },
    { key: 'bestand', header: t('geschiedenis.kolom.bestand'), value: (r) => r.bestandsnaam },
    { key: 'actor', header: t('geschiedenis.kolom.gebruiker'), value: (r) => r.actorNaam },
    {
      key: 'status',
      header: t('geschiedenis.kolom.status'),
      value: (r) => r.status,
      render: (r) => (
        <span className="offerte-lettertypen">
          {statusTag(r)}
          {r.foutmelding && <span className="hint">{r.foutmelding}</span>}
        </span>
      ),
    },
    { key: 'checkboxen', header: t('geschiedenis.kolom.checkboxen'), value: (r) => r.aantalCheckboxen ?? undefined, align: 'right', mono: true, render: (r) => (r.aantalCheckboxen == null ? '—' : String(r.aantalCheckboxen)) },
    { key: 'duur', header: t('geschiedenis.kolom.duur'), value: (r) => r.duurMs ?? undefined, align: 'right', mono: true, render: (r) => duur(r.duurMs) },
    { key: 'lettertypen', header: t('geschiedenis.kolom.lettertypen'), value: (r) => r.lettertypenVervangen.join(', '), sorteerbaar: false, render: lettertypenCel },
  ]

  const kaartVan = (r: ConversieRegel): KaartItem => ({
    id: r.id,
    kop: r.bestandsnaam,
    subtitel: `${datum(r.aangemaaktOp)} · ${r.actorNaam}`,
    merken: statusTag(r),
    velden: [
      { label: t('geschiedenis.kolom.checkboxen'), inhoud: <span className="mono">{r.aantalCheckboxen ?? '—'}</span> },
      { label: t('geschiedenis.kolom.duur'), inhoud: <span className="mono">{duur(r.duurMs)}</span> },
      { label: t('geschiedenis.kolom.lettertypen'), inhoud: lettertypenCel(r), breed: true },
      { label: t('geschiedenis.kolom.fout'), inhoud: r.foutmelding, breed: true, verbergen: !r.foutmelding },
    ],
  })

  const aantalPaginas = lijst ? Math.max(1, Math.ceil(lijst.totaal / PAGINA_GROOTTE)) : 1
  // Gestuurde sortering: de tabel heeft één pagina in handen en de server
  // sorteert al op datum — een eigen sortering zou alleen de zichtbare rijen
  // herschikken (zie de docblock van DataTable).
  const sortering: Sortering = { key: 'datum', richting: 'desc' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-head">
        <h1 className="page-h">{t('geschiedenis.titel')}</h1>
      </div>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Hint>{t('geschiedenis.uitleg')}</Hint>
          {fout && (
            <Alert tone="bad" actie={<Button small variant="ghost" onClick={laad}>{t('algemeen.opnieuwProberen')}</Button>}>
              {fout}
            </Alert>
          )}
          {laden && !lijst && <SkeletonText regels={4} />}
          {lijst && (
            <>
              <Hint>{t('geschiedenis.aantal', { aantal: lijst.totaal })}</Hint>
              {kaarten ? (
                <KaartLijst items={lijst.items.map(kaartVan)} leeg={t('geschiedenis.leeg')} />
              ) : (
                <DataTable
                  columns={kolommen}
                  rows={lijst.items}
                  rowKey={(r) => r.id}
                  empty={t('geschiedenis.leeg')}
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
  )
}
