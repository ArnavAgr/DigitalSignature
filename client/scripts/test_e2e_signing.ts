import fs from 'node:fs';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFNumber } from 'pdf-lib';
import { parseAndUnlockPfx } from '../src/crypto/pfx.ts';
import { createPadesCmsSignature } from '../src/crypto/signer.ts';
import { inspectPdfForSigning } from '../src/pdf/inspector.ts';

async function main() {
  console.log('--- Phase 1 End-to-End PAdES B-B Signing Test ---');

  // 1. Read input unsigned PDF
  const pdfPath = '../Testing/emptydoc.pdf';
  const pdfBytes = new Uint8Array(fs.readFileSync(pdfPath));
  console.log(`Loaded test PDF: ${pdfPath} (${pdfBytes.byteLength} bytes)`);

  // 2. Structural Pre-Flight Inspection
  const inspection = await inspectPdfForSigning(pdfBytes);
  console.log('Pre-flight inspection result:', inspection);
  if (!inspection.isEligible) {
    throw new Error(`PDF rejected by pre-flight inspector: ${inspection.reason}`);
  }

  // 3. Unlock Synthetic Test PFX
  const pfxPath = 'test_synthetic.pfx';
  const pfxBytes = new Uint8Array(fs.readFileSync(pfxPath));
  const signerContext = await parseAndUnlockPfx(pfxBytes, 'TestPassword123!');
  console.log(`Unlocked synthetic certificate for: ${signerContext.details.commonName}`);
  console.log(`Valid until: ${signerContext.details.validTo.toISOString()}`);

  // 4. Prepare PDF with Signature Dictionary & Placeholders
  const doc = await PDFDocument.load(pdfBytes);
  const placeholderHexLength = 16384; // 8192 bytes
  const placeholderHex = '0'.repeat(placeholderHexLength);

  const dummyByteRange = [
    PDFNumber.of(0),
    PDFNumber.of(1000000000),
    PDFNumber.of(1000000000),
    PDFNumber.of(1000000000)
  ];

  const signingTime = new Date();
  const sigDict = doc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'ETSI.CAdES.detached',
    ByteRange: dummyByteRange,
    Contents: PDFHexString.of(placeholderHex),
    M: PDFString.fromDate(signingTime),
    Reason: PDFString.of('Document verified and signed locally in browser'),
  });
  const sigDictRef = doc.context.register(sigDict);

  const sigField = doc.context.obj({
    FT: 'Sig',
    T: PDFString.of('Signature1'),
    V: sigDictRef,
  });
  const sigFieldRef = doc.context.register(sigField);

  let acroForm = doc.catalog.get(PDFName.of('AcroForm'));
  if (!acroForm) {
    const acroFormDict = doc.context.obj({
      Fields: [sigFieldRef],
      SigFlags: PDFNumber.of(3),
    });
    doc.catalog.set(PDFName.of('AcroForm'), acroFormDict);
  } else {
    const acroFormDict = doc.context.lookup(acroForm) as PDFDict;
    let fields = acroFormDict.get(PDFName.of('Fields')) as PDFArray;
    if (!fields) {
      fields = doc.context.obj([sigFieldRef]);
      acroFormDict.set(PDFName.of('Fields'), fields);
    } else {
      fields.push(sigFieldRef);
    }
    acroFormDict.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  const preparedBytes = await doc.save({ useObjectStreams: false });
  const rawString = new TextDecoder('latin1').decode(preparedBytes);

  const contentsMatchStr = '/Contents <';
  const byteRangeMatchStr = '/ByteRange [';

  const contentsIdx = rawString.indexOf(contentsMatchStr);
  const byteRangeIdx = rawString.indexOf(byteRangeMatchStr);

  if (contentsIdx === -1 || byteRangeIdx === -1) {
    throw new Error('Failed to locate /Contents or /ByteRange in prepared PDF.');
  }

  // Calculate ByteRange
  // < is at contentsIdx + '/Contents '.length = contentsIdx + 10
  // contentsHexStart is at contentsIdx + 11
  // > is at contentsIdx + 11 + placeholderHexLength
  // byte right after > is at contentsIdx + 11 + placeholderHexLength + 1
  const offset0 = 0;
  const offset1 = contentsIdx + 10;
  const offset2 = contentsIdx + 11 + placeholderHexLength + 1;
  const offset3 = preparedBytes.length - offset2;

  console.log(`ByteRange calculated: [${offset0}, ${offset1}, ${offset2}, ${offset3}]`);

  // Verify delimiters
  if (preparedBytes[offset1] !== 0x3c) { // '<'
    throw new Error(`Expected '<' at offset1 (${offset1}), found byte ${preparedBytes[offset1]}`);
  }
  if (preparedBytes[offset2 - 1] !== 0x3e) { // '>'
    throw new Error(`Expected '>' at offset2 - 1 (${offset2 - 1}), found byte ${preparedBytes[offset2 - 1]}`);
  }

  // Overwrite the ByteRange dummy numbers in-place with exact padded values
  const exactByteRangeStr = `/ByteRange [ ${offset0} ${offset1.toString().padStart(10, '0')} ${offset2.toString().padStart(10, '0')} ${offset3.toString().padStart(10, '0')} ]`;
  for (let i = 0; i < exactByteRangeStr.length; i++) {
    preparedBytes[byteRangeIdx + i] = exactByteRangeStr.charCodeAt(i);
  }

  // 5. Compute SHA-256 Digest over ByteRange
  const part1 = preparedBytes.subarray(0, offset1);
  const part2 = preparedBytes.subarray(offset2, offset2 + offset3);

  const combined = new Uint8Array(part1.length + part2.length);
  combined.set(part1, 0);
  combined.set(part2, part1.length);

  const hashBuf = await crypto.subtle.digest('SHA-256', combined);
  const byteRangeDigest = new Uint8Array(hashBuf);
  console.log('ByteRange SHA-256 digest computed successfully.');

  // 6. Generate PAdES Baseline B-B CMS Signature
  const cmsResult = await createPadesCmsSignature(byteRangeDigest, signerContext);
  console.log(`CMS signature generated. Hex length: ${cmsResult.cmsHex.length} / max: ${placeholderHexLength}`);

  if (cmsResult.cmsHex.length > placeholderHexLength) {
    throw new Error(`Signature hex length (${cmsResult.cmsHex.length}) exceeded allocated placeholder (${placeholderHexLength}).`);
  }

  // Pad signature with zeroes to fill exact placeholder length
  const paddedHex = cmsResult.cmsHex.padEnd(placeholderHexLength, '0');

  // Inject signature hex into preparedBytes between < and >
  const hexStartOffset = contentsIdx + 11;
  for (let i = 0; i < placeholderHexLength; i++) {
    preparedBytes[hexStartOffset + i] = paddedHex.charCodeAt(i);
  }

  // 7. Save Signed PDF
  const outputPath = 'signed_synthetic_output.pdf';
  fs.writeFileSync(outputPath, Buffer.from(preparedBytes));
  console.log(`Saved signed PDF to: ${outputPath} (${preparedBytes.length} bytes)`);
}

main().catch(err => {
  console.error('Fatal error in end-to-end test:', err);
  process.exit(1);
});

