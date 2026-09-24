// De map met de CPQ-afbeeldingen op de netwerkschijf van de gebruiker
// ("E:\…\Standaardbestanden BID\Foto's\AFBEELDINGEN CPQ"), zodat de app de
// gekoppelde foto's van een offerte kan meesturen. Een webpagina mag niets van
// de schijf lezen dat de gebruiker niet zelf aanwijst; daarom kiest de
// gebruiker de map één keer.
//
// Edge/Chrome (File System Access API): de map wordt onthouden in IndexedDB,
// dus de volgende keer is het één klik op "Toestaan" — of zelfs niets, als de
// browser de toestemming blijvend heeft bewaard. Andere browsers kennen dat
// niet; daar kiest de gebruiker de losse bestanden (zie ConversiePage).
//
// Alleen-lezen, en er wordt alleen gezocht naar de bestandsnamen uit de
// offerte; de rest van de map verlaat de pc niet.

interface BestandHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
}

export interface MapHandle {
  kind: 'directory'
  name: string
  values(): AsyncIterableIterator<BestandHandle | MapHandle>
  queryPermission(opties: { mode: 'read' }): Promise<PermissionState>
  requestPermission(opties: { mode: 'read' }): Promise<PermissionState>
}

type MapKiezer = (opties?: { id?: string; mode?: 'read' }) => Promise<MapHandle>

const DB_NAAM = 'mit-ds-checkbox'
const STORE = 'mappen'
const SLEUTEL = 'afbeeldingen-cpq'
const MAX_DIEPTE = 4

function kiezer(): MapKiezer | null {
  const k = (window as unknown as { showDirectoryPicker?: MapKiezer }).showDirectoryPicker
  return typeof k === 'function' ? k.bind(window) : null
}

/** Kan deze browser een map aanwijzen en onthouden? */
export function kanMapKiezen(): boolean {
  return kiezer() !== null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((klaar, mislukt) => {
    const verzoek = indexedDB.open(DB_NAAM, 1)
    verzoek.onupgradeneeded = () => verzoek.result.createObjectStore(STORE)
    verzoek.onsuccess = () => klaar(verzoek.result)
    verzoek.onerror = () => mislukt(verzoek.error)
  })
}

async function metStore<T>(modus: IDBTransactionMode, actie: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((klaar, mislukt) => {
      const verzoek = actie(db.transaction(STORE, modus).objectStore(STORE))
      verzoek.onsuccess = () => klaar(verzoek.result)
      verzoek.onerror = () => mislukt(verzoek.error)
    })
  } finally {
    db.close()
  }
}

/** De eerder gekozen map, of null (nooit gekozen, of opslag niet beschikbaar). */
export async function onthoudenMap(): Promise<MapHandle | null> {
  if (!kanMapKiezen()) return null
  try {
    return ((await metStore('readonly', (s) => s.get(SLEUTEL))) as MapHandle | undefined) ?? null
  } catch {
    return null
  }
}

/** Laat de gebruiker de map kiezen en onthoudt hem. Gooit AbortError bij annuleren. */
export async function kiesMap(): Promise<MapHandle> {
  const k = kiezer()
  if (!k) throw new Error('Deze browser kan geen map kiezen.')
  const map = await k({ id: SLEUTEL, mode: 'read' })
  try {
    await metStore('readwrite', (s) => s.put(map, SLEUTEL))
  } catch {
    // Niet onthouden is geen fout: dan vraagt de app het de volgende keer weer.
  }
  return map
}

/**
 * Mag de app in deze map lezen? Met `vragen` toont de browser zo nodig de
 * toestemmingsvraag — dat mag alleen vanuit een klik van de gebruiker.
 */
export async function heeftToegang(map: MapHandle, vragen: boolean): Promise<boolean> {
  try {
    if ((await map.queryPermission({ mode: 'read' })) === 'granted') return true
    return vragen && (await map.requestPermission({ mode: 'read' })) === 'granted'
  } catch {
    return false
  }
}

/**
 * Zoekt de bestandsnamen in de map (hoofdletterongevoelig, submappen tot vier
 * diep) en stopt zodra alles gevonden is.
 * @returns op kleine-letternaam
 */
export async function zoekInMap(map: MapHandle, namen: string[]): Promise<Record<string, File>> {
  const gezocht = new Set(namen.map((n) => n.toLowerCase()))
  const gevonden: Record<string, File> = {}
  async function loop(dir: MapHandle, diepte: number) {
    if (diepte > MAX_DIEPTE) return
    try {
      for await (const item of dir.values()) {
        if (Object.keys(gevonden).length === gezocht.size) return
        if (item.kind === 'file') {
          const sleutel = item.name.toLowerCase()
          if (gezocht.has(sleutel) && !gevonden[sleutel]) gevonden[sleutel] = await item.getFile()
        } else {
          await loop(item, diepte + 1)
        }
      }
    } catch {
      // Een submap zonder leesrecht of een weggevallen netwerkverbinding: overslaan.
    }
  }
  await loop(map, 0)
  return gevonden
}
