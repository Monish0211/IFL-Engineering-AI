// Generates the SYNTHETIC demo documents in samples/ — no dependencies.
//   node scripts/generate-sample-docs.mjs
//
// Every value in these files is fictional and exists only to demonstrate
// document upload, retrieval and page citations in IFLCHAT.

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';
import path from 'node:path';

const outDir = path.join(process.cwd(), 'samples');
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------------------
// Minimal PDF writer (Helvetica, WinAnsi encoding, text only)
// ---------------------------------------------------------------------------

const WIN_ANSI = { '—': 0x97, '–': 0x96, '³': 0xb3, '²': 0xb2, '°': 0xb0, '±': 0xb1, '×': 0xd7, '•': 0x95 };

function pdfString(text) {
  const bytes = [];
  for (const ch of text) {
    const code = WIN_ANSI[ch] ?? ch.charCodeAt(0);
    if (code > 0xff) throw new Error(`Character not encodable: ${ch}`);
    if (ch === '(' || ch === ')' || ch === '\\') bytes.push(0x5c);
    bytes.push(code);
  }
  return Buffer.from(bytes);
}

function buildPdf(pages) {
  const objects = []; // Buffers, 1-indexed by position
  const add = (buf) => {
    objects.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'latin1'));
    return objects.length;
  };

  const catalogId = add(''); // placeholder
  const pagesId = add(''); // placeholder
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const boldId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const pageIds = [];
  for (const lines of pages) {
    const parts = [];
    for (const l of lines) {
      parts.push(Buffer.from(`BT /${l.bold ? 'F2' : 'F1'} ${l.size ?? 10} Tf ${l.x} ${l.y} Td (`, 'latin1'), pdfString(l.text), Buffer.from(') Tj ET\n', 'latin1'));
    }
    const content = Buffer.concat(parts);
    const contentId = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')]));
    pageIds.push(
      add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentId} 0 R >>`),
    );
  }
  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, 'latin1');
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`, 'latin1');

  const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = chunks[0].length;
  const offsets = [];
  objects.forEach((obj, i) => {
    const buf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), obj, Buffer.from('\nendobj\n', 'latin1')]);
    offsets.push(offset);
    offset += buf.length;
    chunks.push(buf);
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}

/** Lays out a datasheet page: header block, then sections of label/value rows. */
function datasheetPage(pageNo, totalPages, sections, { title } = {}) {
  const lines = [];
  let y = 800;
  lines.push({ text: 'IFL ENGINEERING — DEMO PROJECT', x: 50, y, size: 9, bold: true });
  lines.push({ text: 'Doc No: IFL-DEMO-DS-P-101   Rev: B', x: 360, y, size: 9 });
  y -= 14;
  lines.push({ text: 'SYNTHETIC DEMO DOCUMENT — ALL VALUES FICTIONAL — NOT FOR ENGINEERING USE', x: 50, y, size: 8 });
  y -= 30;
  if (title) {
    lines.push({ text: title, x: 50, y, size: 16, bold: true });
    y -= 30;
  }
  for (const section of sections) {
    lines.push({ text: section.heading, x: 50, y, size: 11, bold: true });
    y -= 20;
    for (const row of section.rows ?? []) {
      if (Array.isArray(row)) {
        lines.push({ text: row[0], x: 60, y, size: 10 });
        lines.push({ text: row[1], x: 300, y, size: 10 });
      } else {
        lines.push({ text: row, x: 60, y, size: 10 });
      }
      y -= 16;
    }
    y -= 14;
  }
  lines.push({ text: `Page ${pageNo} of ${totalPages}`, x: 270, y: 40, size: 9 });
  return lines;
}

const pumpPages = [
  datasheetPage(
    1,
    4,
    [
      {
        heading: 'DOCUMENT INFORMATION',
        rows: [
          ['Project', 'Demo Cooling Water Upgrade (fictional)'],
          ['Client', 'Example Client Ltd (fictional)'],
          ['Document title', 'Centrifugal Pump Datasheet — P-101A/B'],
          ['Revision', 'B — Issued for Purchase'],
        ],
      },
      {
        heading: '1. GENERAL',
        rows: [
          ['Tag number', 'P-101A/B'],
          ['Service', 'Cooling Water Circulation Pump'],
          ['Quantity', '2 (1 operating + 1 standby)'],
          ['Pump type', 'Horizontal, single-stage, end-suction centrifugal'],
          ['Driver', 'Electric motor'],
          ['Location', 'Outdoor, non-hazardous (safe) area'],
          ['Applicable project specification', 'IFL-DEMO-SPEC-MEC-001 (fictional)'],
        ],
      },
    ],
    { title: 'CENTRIFUGAL PUMP DATASHEET' },
  ),
  datasheetPage(2, 4, [
    {
      heading: '2. OPERATING CONDITIONS',
      rows: [
        ['Liquid', 'Cooling water (treated)'],
        ['Pumping temperature (normal / max)', '35 °C / 45 °C'],
        ['Specific gravity at pumping temperature', '0.994'],
        ['Rated flow', '250 m³/h'],
        ['Normal flow', '220 m³/h'],
        ['Minimum continuous flow', '75 m³/h'],
        ['Suction pressure (rated)', '2.5 barg'],
        ['Discharge pressure (rated)', '8.4 barg'],
        ['Differential pressure', '5.9 bar'],
        ['Differential head', '60.5 m'],
        ['NPSH available', '8.5 m'],
      ],
    },
    {
      heading: '3. DESIGN CONDITIONS',
      rows: [
        ['Design pressure (casing)', '16 barg'],
        ['Design temperature', '80 °C'],
        ['Casing MAWP', '16 barg at 80 °C'],
        ['Shut-off head (max. diameter impeller)', '74 m'],
        ['Corrosion allowance', '3 mm'],
      ],
    },
  ]),
  datasheetPage(3, 4, [
    {
      heading: '4. MATERIALS OF CONSTRUCTION',
      rows: [
        ['Casing', 'ASTM A216 Gr. WCB (cast carbon steel)'],
        ['Impeller', 'ASTM A351 Gr. CF8M (cast 316 stainless steel)'],
        ['Shaft', 'AISI 420 stainless steel'],
        ['Wear rings (casing / impeller)', '12% chromium stainless steel, hardened'],
        ['Casing gasket', 'Spiral wound, 316 SS with graphite filler'],
        ['Mechanical seal', 'Single cartridge seal, SiC vs carbon faces'],
        ['Casing bolting', 'ASTM A193 B7 / A194 2H'],
        ['Baseplate', 'Fabricated carbon steel, drain rim'],
      ],
    },
    {
      heading: '5. PERFORMANCE (VENDOR GUARANTEED)',
      rows: [
        ['Rated speed', '2960 rpm'],
        ['Efficiency at rated point', '78 %'],
        ['NPSH required at rated flow', '4.2 m'],
        ['Absorbed power at rated point', '52.4 kW'],
        ['Motor rating', '75 kW, 400 V, 3 ph, 50 Hz, 2-pole, IP55'],
      ],
    },
  ]),
  datasheetPage(4, 4, [
    {
      heading: '6. INSPECTION AND TESTING',
      rows: [
        ['Hydrostatic test (casing)', '24 barg, 30 min hold — Witness (W)'],
        ['Performance test', 'Witness (W)'],
        ['NPSH test', 'Not required'],
        ['Mechanical run test', 'Witness (W)'],
        ['Final inspection before shipment', 'Hold (H)'],
      ],
    },
    {
      heading: '7. NOTES',
      rows: [
        '1. This is a synthetic document created to demonstrate the IFL Engineering',
        '   AI Assistant. All tags, values and references are fictional.',
        '2. Vendor to confirm casing MAWP and hydrostatic test pressure in the offer.',
        '3. All values to be verified against the approved project specification.',
      ],
    },
    {
      heading: '8. REVISION HISTORY',
      rows: [
        ['Rev A', 'Issued for Review'],
        ['Rev B', 'Issued for Purchase — rated flow updated'],
      ],
    },
  ]),
];

writeFileSync(path.join(outDir, 'Pump_Datasheet_P-101.pdf'), buildPdf(pumpPages));

// ---------------------------------------------------------------------------
// TXT sample
// ---------------------------------------------------------------------------

writeFileSync(
  path.join(outDir, 'P-101_Vendor_Clarifications.txt'),
  `P-101A/B COOLING WATER PUMPS — VENDOR TECHNICAL CLARIFICATIONS
SYNTHETIC DEMO DOCUMENT — ALL VALUES FICTIONAL — NOT FOR ENGINEERING USE

TQ-01  Seal arrangement
Vendor proposed a single cartridge mechanical seal with silicon carbide vs carbon faces.
Response: Accepted.

TQ-02  Motor enclosure
Vendor offered IP55 motors. Project datasheet requires IP55 minimum.
Response: Accepted.

TQ-03  Performance test tolerance
Vendor requested that the performance test be performed at the vendor's works with
clean cold water. Response: Accepted; the client will witness the test.

TQ-04  Delivery
Vendor quoted 26 weeks ex-works from purchase order. Response: Noted by procurement.
`,
);

// ---------------------------------------------------------------------------
// DOCX sample (hand-built OOXML zip, stored with deflate)
// ---------------------------------------------------------------------------

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, compressed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(files).length;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const para = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

const docxBody = [
  para('P-101A/B Pump Package — Scope of Supply', 'Heading1'),
  para('SYNTHETIC DEMO DOCUMENT — ALL VALUES FICTIONAL — NOT FOR ENGINEERING USE'),
  para('Included in vendor scope', 'Heading2'),
  para('Two horizontal centrifugal pumps (P-101A and P-101B), each with electric motor, coupling, coupling guard and common baseplate.'),
  para('Mechanical seals, seal flush piping, and one set of commissioning spares per pump.'),
  para('Vendor documentation per the VDRL, including the ITP, performance curves, GA drawing and IOM manual.'),
  para('Excluded from vendor scope', 'Heading2'),
  para('Foundation bolts and grouting, field piping beyond the pump nozzles, and electrical cabling beyond the motor terminal box.'),
  para('Spare parts', 'Heading2'),
  para('Two-year operating spares to be quoted separately as an option.'),
].join('');

const docx = zip({
  '[Content_Types].xml':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  '_rels/.rels':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/_rels/document.xml.rels':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  'word/styles.xml':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>',
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${docxBody}</w:body></w:document>`,
});
writeFileSync(path.join(outDir, 'P-101_Scope_of_Supply.docx'), docx);

console.log('Wrote samples/Pump_Datasheet_P-101.pdf, samples/P-101_Vendor_Clarifications.txt, samples/P-101_Scope_of_Supply.docx');
