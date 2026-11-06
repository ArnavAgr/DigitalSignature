import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFNumber } from 'pdf-lib';

export interface PreparedPdfContainer {
  preparedBytes: Uint8Array;
  byteRangeDigest: Uint8Array;
  byteRange: [number, number, number, number];
  placeholderHexLength: number;
  injectSignature: (cmsHex: string) => Uint8Array;
}

/**
 * Injects a PAdES Baseline B-B compliant invisible signature field and dictionary
 * into an unsigned PDF, calculates exact ByteRange offsets, and prepares the hash to sign.
 * 
 * Rules enforced:
 * - SubFilter: /ETSI.CAdES.detached
 * - Filter: /Adobe.PPKLite
 * - /M: UTC claimed signing time (D:YYYYMMDDHHmmSSZ)
 * - ByteRange padded with zeroes so byte offsets remain completely immutable
 */
export async function preparePdfForSigning(
  pdfBytes: Uint8Array,
  options: {
    reason?: string;
    signingTime?: Date;
    placeholderHexLength?: number;
  } = {}
): Promise<PreparedPdfContainer> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
  const placeholderHexLength = options.placeholderHexLength || 16384; // 8192 bytes allocated
  const placeholderHex = '0'.repeat(placeholderHexLength);

  // 10-digit dummy numbers match the padded ByteRange representation
  const dummyByteRange = [
    PDFNumber.of(0),
    PDFNumber.of(1000000000),
    PDFNumber.of(1000000000),
    PDFNumber.of(1000000000)
  ];

  const signingTime = options.signingTime || new Date();
  const sigDict = doc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'ETSI.CAdES.detached',
    ByteRange: dummyByteRange,
    Contents: PDFHexString.of(placeholderHex),
    M: PDFString.fromDate(signingTime),
    Reason: PDFString.of(options.reason || 'Document signed locally in browser'),
  });
  const sigDictRef = doc.context.register(sigDict);

  const sigField = doc.context.obj({
    FT: 'Sig',
    T: PDFString.of('Signature1'),
    V: sigDictRef,
  });
  const sigFieldRef = doc.context.register(sigField);

  // Bind to AcroForm
  const acroForm = doc.catalog.get(PDFName.of('AcroForm'));
  if (!acroForm) {
    const acroFormDict = doc.context.obj({
      Fields: [sigFieldRef],
      SigFlags: PDFNumber.of(3), // SignaturesExist (1) | AppendOnly (2)
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

  // Save document bytes without object streams to ensure readable dictionary markers
  const preparedBytes = await doc.save({ useObjectStreams: false });
  const rawString = new TextDecoder('latin1').decode(preparedBytes);

  const contentsMatchStr = '/Contents <';
  const byteRangeMatchStr = '/ByteRange [';

  const contentsIdx = rawString.indexOf(contentsMatchStr);
  const byteRangeIdx = rawString.indexOf(byteRangeMatchStr);

  if (contentsIdx === -1 || byteRangeIdx === -1) {
    throw new Error('Failed to locate /Contents or /ByteRange placeholder markers in prepared PDF.');
  }

  // Calculate ByteRange
  const offset0 = 0;
  const offset1 = contentsIdx + 10; // index of '<'
  const offset2 = contentsIdx + 11 + placeholderHexLength + 1; // index right after '>'
  const offset3 = preparedBytes.length - offset2;

  // Delimiter sanity checks
  if (preparedBytes[offset1] !== 0x3c) {
    throw new Error(`Byte offset sanity error: expected '<' at ${offset1}, found ${preparedBytes[offset1]}`);
  }
  if (preparedBytes[offset2 - 1] !== 0x3e) {
    throw new Error(`Byte offset sanity error: expected '>' at ${offset2 - 1}, found ${preparedBytes[offset2 - 1]}`);
  }

  // Overwrite ByteRange placeholder in-place with exact padded values
  const exactByteRangeStr = `/ByteRange [ ${offset0} ${offset1.toString().padStart(10, '0')} ${offset2.toString().padStart(10, '0')} ${offset3.toString().padStart(10, '0')} ]`;
  for (let i = 0; i < exactByteRangeStr.length; i++) {
    preparedBytes[byteRangeIdx + i] = exactByteRangeStr.charCodeAt(i);
  }

  // Compute SHA-256 Digest over ByteRange
  const part1 = preparedBytes.subarray(0, offset1);
  const part2 = preparedBytes.subarray(offset2, offset2 + offset3);

  const combined = new Uint8Array(part1.length + part2.length);
  combined.set(part1, 0);
  combined.set(part2, part1.length);

  const hashBuf = await crypto.subtle.digest('SHA-256', combined);
  const byteRangeDigest = new Uint8Array(hashBuf);

  const hexStartOffset = contentsIdx + 11;

  return {
    preparedBytes,
    byteRangeDigest,
    byteRange: [offset0, offset1, offset2, offset3],
    placeholderHexLength,
    injectSignature: (cmsHex: string): Uint8Array => {
      if (cmsHex.length > placeholderHexLength) {
        throw new Error(
          `Signature size error: CMS hex signature (${cmsHex.length} chars) exceeded allocated placeholder (${placeholderHexLength} chars).`
        );
      }

      // Pad signature with trailing zeroes to fill the exact allocated placeholder
      const paddedHex = cmsHex.padEnd(placeholderHexLength, '0');

      for (let i = 0; i < placeholderHexLength; i++) {
        preparedBytes[hexStartOffset + i] = paddedHex.charCodeAt(i);
      }

      return preparedBytes;
    }
  };
}

