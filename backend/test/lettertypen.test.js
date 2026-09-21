// De lettertype-laag: familienamen uit een fontbestand lezen (voor de
// statuskaart) en de vergelijking DOCX-gevraagd vs. PDF-aanwezig.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  VEREISTE_LETTERTYPEN,
  beschikbareLettertypen,
  leesNamen,
  normaliseerLettertype,
  ontbrekendeVereisteLettertypen,
  vergelijkLettertypen,
} from '../lib/lettertypen.js'

const fontsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts')

test('leest familie- en PostScript-namen uit de name-tabel van een TTF', async () => {
  const { families, postscript } = leesNamen(await readFile(path.join(fontsDir, 'DejaVuSans.ttf')))
  assert.ok(families.includes('DejaVu Sans'), `families: ${families}`)
  assert.ok(postscript.includes('DejaVuSans'), `postscript: ${postscript}`)
})

test('de meegeleverde fontmap bevat DejaVu Sans (voor het ☐-glyph) en meldt de DaxPro-families als ontbrekend', async (t) => {
  const bestanden = await beschikbareLettertypen()
  assert.ok(bestanden.some((b) => b.families.includes('DejaVu Sans')))
  const ontbreekt = ontbrekendeVereisteLettertypen(bestanden)
  if (ontbreekt.length === 0) {
    t.diagnostic('DaxPro-bestanden aanwezig in de fontmap — de ontbrekend-controle is hier niet te testen')
  } else {
    assert.deepEqual(ontbreekt, VEREISTE_LETTERTYPEN.filter((v) => ontbreekt.includes(v)))
  }
  // Met een nep-DaxPro erbij verdwijnt hij uit de lijst.
  const metDax = [...bestanden, { bestand: 'x.otf', pad: '/x', families: ['DaxPro Light'], postscript: ['DaxPro-Light'] }]
  assert.ok(!ontbrekendeVereisteLettertypen(metDax).includes('DaxPro-Light'))
})

test('normaliseert subset-voorvoegsel, hoofdletters en scheidingstekens weg', () => {
  assert.equal(normaliseerLettertype('BAAAAA+DaxPro-Light'), 'daxprolight')
  assert.equal(normaliseerLettertype('DaxPro Light'), 'daxprolight')
  assert.equal(normaliseerLettertype(null), '')
})

test('vergelijkt gevraagde lettertypen met die in de PDF, familie tegen snit', () => {
  const r = vergelijkLettertypen(
    ['DaxPro', 'DaxPro-Light', 'DaxPro-Medium', 'Calibri'],
    ['DaxPro-Bold', 'DaxPro-Light', 'DejaVuSans'],
  )
  assert.deepEqual(r.vervangen, ['DaxPro-Medium', 'Calibri'])
})
