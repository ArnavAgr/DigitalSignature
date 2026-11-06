import fs from 'node:fs';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFString,
  PDFHexString,
  PDFNumber,
  StandardFonts
} from 'pdf-lib';
import { parseAndUnlockPfx } from '../src/crypto/pfx.ts';
import { createPadesCmsSignature } from '../src/crypto/signer.ts';

async function main() {
  console.log('--- Testing Visible Signature Stamping with Appearance Stream ---');

  const pdfPath = '../Testing/emptydoc.pdf';
  const pdfBytes = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await PDFDocument.load(pdfBytes);

  const pages = doc.getPages();
  const pageIndex = pages.length - 1; // Last page
  const page = pages[pageIndex];
  const { width: pageWidth, height: pageHeight } = page.getSize();

  // Position stamp at bottom right
  const stampWidth = 200;
  const stampHeight = 65;
  const stampX = pageWidth - stampWidth - 40;
  const stampY = 40;

  console.log(`Page: ${pageIndex + 1}, Placement: [${stampX}, ${stampY}, ${stampX + stampWidth}, ${stampY + stampHeight}]`);

  // Embed standard Helvetica fonts (no external files required)
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  // Read signer context
  const pfxBuf = fs.readFileSync('test_synthetic.pfx');
  const signerContext = await parseAndUnlockPfx(new Uint8Array(pfxBuf), 'TestPassword123!');
  const signerName = signerContext.details.commonName;
  const orgName = signerContext.details.organization || '';
  const dateStr = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  // Sanitize text for PDF string literals
  const safeName = signerName.replace(/[()\\]/g, '');
  const safeOrg = orgName.replace(/[()\\]/g, '');

  // Form XObject PDF content operators
  const operators = [
    'q',
    // Background fill (light subtle gray)
    '0.97 0.98 1 rg',
    `0 0 ${stampWidth} ${stampHeight} re`,
    'f',
    // Border stroke (professional blue)
    '0.15 0.45 0.85 RG',
    '1.2 w',
    `0 0 ${stampWidth} ${stampHeight} re`,
    'S',
    // Decorative left accent bar
    '0.15 0.45 0.85 rg',
    `0 0 4 ${stampHeight} re`,
    'f',
    // Text drawing
    'BT',
    // Title
    '/F_Bold 9 Tf',
    '0.12 0.25 0.55 rg',
    '10 49 Td',
    '(DIGITALLY SIGNED) Tj',
    // Signer name
    '/F_Reg 8 Tf',
    '0.15 0.15 0.15 rg',
    '0 -13 Td',
    `(${safeName}) Tj`,
    // Org name if present
    '0 -11 Td',
    `(${safeOrg}) Tj`,
    // Date & PAdES note
    '/F_Reg 7 Tf',
    '0.4 0.4 0.4 rg',
    '0 -10 Td',
    `(${dateStr}) Tj`,
    'ET',
    'Q'
  ].join('\n');

  const xObject = doc.context.stream(operators, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, stampWidth, stampHeight],
    Resources: {
      Font: {
        F_Bold: boldFont.ref,
        F_Reg: font.ref,
      },
    },
  });
  const xObjectRef = doc.context.register(xObject);

  // Appearance Dictionary
  const apDict = doc.context.obj({
    N: xObjectRef,
  });

  // Placeholder signature dictionary
  const placeholderHexLength = 16384;
  const placeholderHex = '0'.repeat(placeholderHexLength);
  const dummyByteRange = [
    PDFNumber.of(0),
    PDFNumber.of(1000000000),
    PDFNumber.of(1000000000),
    PDFNumber.of(1000000000),
  ];

  const signingTime = new Date();
  const sigDict = doc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'ETSI.CAdES.detached',
    ByteRange: dummyByteRange,
    Contents: PDFHexString.of(placeholderHex),
    M: PDFString.fromDate(signingTime),
    Reason: PDFString.of('Document verified and signed'),
  });
  const sigDictRef = doc.context.register(sigDict);

  // Widget Annotation & Field Dictionary (combined per PDF 32000-1)
  const widgetDict = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of('Signature1'),
    V: sigDictRef,
    Rect: [
      PDFNumber.of(stampX),
      PDFNumber.of(stampY),
      PDFNumber.of(stampX + stampWidth),
      PDFNumber.of(stampY + stampHeight),
    ],
    P: page.ref,
    F: PDFNumber.of(132), // Print (4) + Locked (128)
    AP: apDict,
  });
  const widgetDictRef = doc.context.register(widgetDict);

  // Attach widget annotation to page's /Annots array
  let annots = page.node.get(PDFName.of('Annots'));
  if (!annots) {
    const annotsArray = doc.context.obj([widgetDictRef]);
    page.node.set(PDFName.of('Annots'), annotsArray);
  } else {
    const annotsArray = doc.context.lookup(annots) as PDFArray;
    annotsArray.push(widgetDictRef);
  }

  // Attach field to AcroForm
  let acroForm = doc.catalog.get(PDFName.of('AcroForm'));
  if (!acroForm) {
    const acroFormDict = doc.context.obj({
      Fields: [widgetDictRef],
      SigFlags: PDFNumber.of(3),
    });
    doc.catalog.set(PDFName.of('AcroForm'), acroFormDict);
  } else {
    const acroFormDict = doc.context.lookup(acroForm) as PDFDict;
    let fields = acroFormDict.get(PDFName.of('Fields')) as PDFArray;
    if (!fields) {
      fields = doc.context.obj([widgetDictRef]);
      acroFormDict.set(PDFName.of('Fields'), fields);
    } else {
      fields.push(widgetDictRef);
    }
    acroFormDict.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  const preparedBytes = await doc.save({ useObjectStreams: false });
  const rawString = new TextDecoder('latin1').decode(preparedBytes);

  const contentsIdx = rawString.indexOf('/Contents <');
  const byteRangeIdx = rawString.indexOf('/ByteRange [');

  if (contentsIdx === -1 || byteRangeIdx === -1) {
    throw new Error('Failed to locate /Contents or /ByteRange in prepared PDF.');
  }

  const offset0 = 0;
  const offset1 = contentsIdx + 10;
  const offset2 = contentsIdx + 11 + placeholderHexLength + 1;
  const offset3 = preparedBytes.length - offset2;

  const exactByteRangeStr = `/ByteRange [ ${offset0} ${offset1.toString().padStart(10, '0')} ${offset2.toString().padStart(10, '0')} ${offset3.toString().padStart(10, '0')} ]`;
  for (let i = 0; i < exactByteRangeStr.length; i++) {
    preparedBytes[byteRangeIdx + i] = exactByteRangeStr.charCodeAt(i);
  }

  // Digest over ByteRange
  const part1 = preparedBytes.subarray(0, offset1);
  const part2 = preparedBytes.subarray(offset2, offset2 + offset3);

  const combined = new Uint8Array(part1.length + part2.length);
  combined.set(part1, 0);
  combined.set(part2, part1.length);

  const hashBuf = await crypto.subtle.digest('SHA-256', combined);
  const byteRangeDigest = new Uint8Array(hashBuf);

  // Generate PAdES B-B CMS Signature
  const cmsResult = await createPadesCmsSignature(byteRangeDigest, signerContext);
  const paddedHex = cmsResult.cmsHex.padEnd(placeholderHexLength, '0');

  const hexStartOffset = contentsIdx + 11;
  for (let i = 0; i < placeholderHexLength; i++) {
    preparedBytes[hexStartOffset + i] = paddedHex.charCodeAt(i);
  }

  const outputPath = 'signed_visible_synthetic_output.pdf';
  fs.writeFileSync(outputPath, Buffer.from(preparedBytes));
  console.log(`Saved visible signed PDF: ${outputPath} (${preparedBytes.length} bytes)`);
}

main().catch(console.error);

