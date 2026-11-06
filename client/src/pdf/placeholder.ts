import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFString,
  PDFHexString,
  PDFNumber,
  StandardFonts,
  PDFFont
} from 'pdf-lib';

export interface VisualStampOptions {
  enabled: boolean;
  page?: 'first' | 'last' | number;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'custom';
  customCoordinates?: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  };
  signerName: string;
  organization?: string;
}

export interface CharacterEncodingWarning {
  field: 'signerName' | 'organization';
  originalText: string;
  renderedText: string;
  unsupportedCharacters: string[];
  fallbackType: 'transliterated' | 'substituted' | 'transliterated_and_substituted';
  message: string;
}

export interface PreparePdfOptions {
  reason?: string;
  signingTime?: Date;
  placeholderHexLength?: number;
  visualStamp?: VisualStampOptions;
}

export interface PreparedPdfContainer {
  preparedBytes: Uint8Array;
  byteRangeDigest: Uint8Array;
  byteRange: [number, number, number, number];
  placeholderHexLength: number;
  warnings: CharacterEncodingWarning[];
  injectSignature: (cmsHex: string) => Uint8Array;
}

/**
 * Prepares a clean unsigned PDF for PAdES Baseline B-B signing,
 * optionally injecting a visual widget annotation with a vector appearance stream.
 * 
 * Supports:
 * - Unsigned PDFs with existing AcroForm fields (resolves indirect /Fields arrays)
 * - Rotated pages (0, 90, 180, 270 degrees)
 * - Portrait & Landscape orientations (A4, Letter, etc.)
 * - Non-ASCII and Unicode characters in signer name/organization with safe fallback
 */
export async function preparePdfForSigning(
  pdfBytes: Uint8Array,
  options: PreparePdfOptions = {}
): Promise<PreparedPdfContainer> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
  const placeholderHexLength = options.placeholderHexLength || 16384;
  const placeholderHex = '0'.repeat(placeholderHexLength);

  const dummyByteRange = [
    PDFNumber.of(0),
    PDFNumber.of(1000000000),
    PDFNumber.of(1000000000),
    PDFNumber.of(1000000000)
  ];

  const signingTime = options.signingTime || new Date();
  const reasonText = options.reason || 'Document signed locally in browser';
  const warnings: CharacterEncodingWarning[] = [];

  // 1. Signature Dictionary
  const sigDict = doc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'ETSI.CAdES.detached',
    ByteRange: dummyByteRange,
    Contents: PDFHexString.of(placeholderHex),
    M: PDFString.fromDate(signingTime),
    Reason: PDFString.of(reasonText),
  });
  const sigDictRef = doc.context.register(sigDict);

  // 2. Field & Optional Visual Widget Setup
  let fieldDictRef;

  const visual = options.visualStamp;
  if (visual && visual.enabled) {
    const pages = doc.getPages();
    const pageCount = pages.length;

    // Resolve target page index (0-based)
    let targetPageIndex = pageCount - 1; // default 'last'
    if (visual.page === 'first') {
      targetPageIndex = 0;
    } else if (typeof visual.page === 'number') {
      const clamped = Math.max(1, Math.min(visual.page, pageCount));
      targetPageIndex = clamped - 1;
    }

    const targetPage = pages[targetPageIndex];
    const { width: unrotWidth, height: unrotHeight } = targetPage.getSize();
    const rotationAngle = (targetPage.getRotation().angle || 0) % 360;

    // Determine visual dimensions on screen
    const isSideways = rotationAngle === 90 || rotationAngle === 270;
    const visualPageWidth = isSideways ? unrotHeight : unrotWidth;
    const visualPageHeight = isSideways ? unrotWidth : unrotHeight;

    // Default stamp box dimensions (points)
    const stampWidth = visual.customCoordinates?.width || 200;
    const stampHeight = visual.customCoordinates?.height || 65;
    const margin = 40;

    // Calculate visual coordinates on screen (bottom-left origin on visual page)
    let visX = visualPageWidth - stampWidth - margin;
    let visY = margin;

    const pos = visual.position || 'bottom-right';
    if (pos === 'bottom-left') {
      visX = margin;
      visY = margin;
    } else if (pos === 'top-right') {
      visX = visualPageWidth - stampWidth - margin;
      visY = visualPageHeight - stampHeight - margin;
    } else if (pos === 'top-left') {
      visX = margin;
      visY = visualPageHeight - stampHeight - margin;
    } else if (pos === 'custom' && visual.customCoordinates) {
      visX = Math.max(0, Math.min(visual.customCoordinates.x, visualPageWidth - stampWidth));
      visY = Math.max(0, Math.min(visual.customCoordinates.y, visualPageHeight - stampHeight));
    }

    // Map visual coordinates to unrotated user space based on rotationAngle
    let userX = visX;
    let userY = visY;
    let userW = stampWidth;
    let userH = stampHeight;

    if (rotationAngle === 90) {
      userX = unrotWidth - visY - stampHeight;
      userY = visX;
      userW = stampHeight;
      userH = stampWidth;
    } else if (rotationAngle === 180) {
      userX = unrotWidth - visX - stampWidth;
      userY = unrotHeight - visY - stampHeight;
      userW = stampWidth;
      userH = stampHeight;
    } else if (rotationAngle === 270) {
      userX = visY;
      userY = unrotHeight - visX - stampWidth;
      userW = stampHeight;
      userH = stampWidth;
    }

    // Embed Standard Helvetica Fonts
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

    // Format & encode text safely with warning detection for unencodable characters
    const rawSignerName = visual.signerName || 'Authorized Signer';
    const rawOrg = visual.organization || '';
    const dateFormatted = signingTime.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    const titleResult = encodeTextSafely(boldFont, 'DIGITALLY SIGNED');
    const signerResult = encodeTextSafely(font, rawSignerName, 'signerName');
    if (signerResult.warning) {
      warnings.push(signerResult.warning);
    }

    const orgResult = encodeTextSafely(font, rawOrg || 'Individual Verification', 'organization');
    if (orgResult.warning) {
      warnings.push(orgResult.warning);
    }

    const dateResult = encodeTextSafely(font, dateFormatted);

    const hexTitle = titleResult.hex;
    const hexSigner = signerResult.hex;
    const hexOrg = orgResult.hex;
    const hexDate = dateResult.hex;

    // Text drawing operators
    const textLines = [
      'BT',
      '/F_Bold 9 Tf',
      '0.12 0.25 0.55 rg',
      '10 49 Td',
      `${hexTitle} Tj`,
      '/F_Reg 8 Tf',
      '0.15 0.15 0.15 rg',
      '0 -13 Td',
      `${hexSigner} Tj`,
      '0 -11 Td',
      `${hexOrg} Tj`,
      '/F_Reg 7 Tf',
      '0.4 0.4 0.4 rg',
      '0 -10 Td',
      `${hexDate} Tj`,
      'ET'
    ].join('\n');

    // Vector Appearance Stream Operators
    const operators = [
      'q',
      // Background subtle fill
      '0.97 0.98 1 rg',
      `0 0 ${stampWidth} ${stampHeight} re`,
      'f',
      // Border stroke
      '0.15 0.45 0.85 RG',
      '1.2 w',
      `0 0 ${stampWidth} ${stampHeight} re`,
      'S',
      // Left vertical accent bar
      '0.15 0.45 0.85 rg',
      `0 0 4 ${stampHeight} re`,
      'f',
      textLines,
      'Q'
    ].join('\n');

    // Form XObject for /AP /N
    // If the page is rotated, we orient the appearance stream using /Matrix or /MK /R
    let matrix: number[] | undefined = undefined;
    if (rotationAngle === 90) {
      matrix = [0, 1, -1, 0, stampHeight, 0];
    } else if (rotationAngle === 180) {
      matrix = [-1, 0, 0, -1, stampWidth, stampHeight];
    } else if (rotationAngle === 270) {
      matrix = [0, -1, 1, 0, 0, stampWidth];
    }

    const xObjectDict: Record<string, any> = {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, stampWidth, stampHeight],
      Resources: {
        Font: {
          F_Bold: boldFont.ref,
          F_Reg: font.ref,
        },
      },
    };
    if (matrix) {
      xObjectDict.Matrix = matrix;
    }

    const xObject = doc.context.stream(operators, xObjectDict);
    const xObjectRef = doc.context.register(xObject);

    const apDict = doc.context.obj({
      N: xObjectRef,
    });

    // Combined Field and Widget Annotation Dictionary
    const widgetDict: Record<string, any> = {
      Type: 'Annot',
      Subtype: 'Widget',
      FT: 'Sig',
      T: PDFString.of('Signature1'),
      V: sigDictRef,
      Rect: [
        PDFNumber.of(userX),
        PDFNumber.of(userY),
        PDFNumber.of(userX + userW),
        PDFNumber.of(userY + userH),
      ],
      P: targetPage.ref,
      F: PDFNumber.of(132), // Print (4) + Locked (128)
      AP: apDict,
    };
    if (rotationAngle > 0) {
      widgetDict.MK = doc.context.obj({
        R: PDFNumber.of(rotationAngle)
      });
    }

    fieldDictRef = doc.context.register(doc.context.obj(widgetDict));

    // Attach to page /Annots
    let annots = targetPage.node.get(PDFName.of('Annots'));
    if (!annots) {
      const annotsArray = doc.context.obj([fieldDictRef]);
      targetPage.node.set(PDFName.of('Annots'), annotsArray);
    } else {
      const annotsArray = doc.context.lookup(annots) as PDFArray;
      annotsArray.push(fieldDictRef);
    }
  } else {
    // Standard Invisible Signature Field
    const sigField = doc.context.obj({
      FT: 'Sig',
      T: PDFString.of('Signature1'),
      V: sigDictRef,
    });
    fieldDictRef = doc.context.register(sigField);
  }

  // 3. Attach to Document AcroForm (resolving indirect /Fields reference)
  const acroForm = doc.catalog.get(PDFName.of('AcroForm'));
  if (!acroForm) {
    const acroFormDict = doc.context.obj({
      Fields: [fieldDictRef],
      SigFlags: PDFNumber.of(3),
    });
    doc.catalog.set(PDFName.of('AcroForm'), acroFormDict);
  } else {
    const acroFormDict = doc.context.lookup(acroForm) as PDFDict;
    const fieldsObj = acroFormDict.get(PDFName.of('Fields'));
    if (!fieldsObj) {
      const fields = doc.context.obj([fieldDictRef]);
      acroFormDict.set(PDFName.of('Fields'), fields);
    } else {
      const fieldsArray = doc.context.lookup(fieldsObj) as PDFArray;
      fieldsArray.push(fieldDictRef);
    }
    acroFormDict.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  // 4. Save prepared bytes
  const preparedBytes = await doc.save({ useObjectStreams: false });
  const rawString = new TextDecoder('latin1').decode(preparedBytes);

  const contentsMatchStr = '/Contents <';
  const byteRangeMatchStr = '/ByteRange [';

  const contentsIdx = rawString.indexOf(contentsMatchStr);
  const byteRangeIdx = rawString.indexOf(byteRangeMatchStr);

  if (contentsIdx === -1 || byteRangeIdx === -1) {
    throw new Error('Failed to locate /Contents or /ByteRange placeholder markers in prepared PDF.');
  }

  // Calculate ByteRange offsets
  const offset0 = 0;
  const offset1 = contentsIdx + 10;
  const offset2 = contentsIdx + 11 + placeholderHexLength + 1;
  const offset3 = preparedBytes.length - offset2;

  // Overwrite ByteRange in-place with exact padded values
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
    warnings,
    injectSignature: (cmsHex: string): Uint8Array => {
      if (cmsHex.length > placeholderHexLength) {
        throw new Error(
          `Signature size error: CMS hex signature (${cmsHex.length} chars) exceeded allocated placeholder (${placeholderHexLength} chars).`
        );
      }

      const paddedHex = cmsHex.padEnd(placeholderHexLength, '0');

      for (let i = 0; i < placeholderHexLength; i++) {
        preparedBytes[hexStartOffset + i] = paddedHex.charCodeAt(i);
      }

      return preparedBytes;
    }
  };
}

export interface TextEncodingResult {
  hex: string;
  renderedText: string;
  warning?: CharacterEncodingWarning;
}

/**
 * Encodes text into a PDF hexadecimal literal string `<HEX>` for standard Type 1 fonts.
 * 
 * IMPORTANT ARCHITECTURAL NOTE:
 * Standard PDF fonts (Helvetica, Times, Courier) defined in ISO 32000-1 §9.6.2.2 are NOT embedded
 * font programs. They contain only font metric descriptors, relying on the recipient's PDF viewer
 * (Acrobat, Chrome, Edge) to substitute glyphs using system fonts according to the WinAnsi (CP1252) encoding.
 * 
 * FALLBACK & WARNING POLICY:
 * - Direct WinAnsi characters (including Western European accents: é, è, ê, à, ç, ö, ä, ü, ñ, ø, etc.)
 *   encode directly with 100% visual fidelity and produce no warnings.
 * - Extended Latin diacritics (e.g. Č, š, Ł, đ) are mapped to base Latin letters via targeted transliteration
 *   and Unicode NFD decomposition, producing an explicit warning so the caller and user are notified.
 * - Non-Latin scripts (e.g. Cyrillic, CJK, Arabic, Emoji) that cannot be represented in WinAnsi are replaced
 *   with '?' and explicitly reported in the returned warning structure (no silent data transformation).
 */
function encodeTextSafely(
  font: PDFFont,
  text: string,
  field?: 'signerName' | 'organization'
): TextEncodingResult {
  // 1. Attempt direct WinAnsi encoding
  try {
    return {
      hex: `<${font.encodeText(text).asString()}>`,
      renderedText: text
    };
  } catch {
    // 2. Character-by-character analysis for safe fallback & precise warning reporting
    const transliteratedChars: string[] = [];
    const substitutedChars: string[] = [];
    let safeRendered = '';

    for (const ch of text) {
      try {
        font.encodeText(ch);
        safeRendered += ch;
        continue;
      } catch {
        // Character not encodable directly in WinAnsi
      }

      // Try targeted stroke transliteration
      let mapped = ch
        .replace(/Ł/g, 'L')
        .replace(/ł/g, 'l')
        .replace(/Đ/g, 'D')
        .replace(/đ/g, 'd');

      // Try Unicode NFD diacritic decomposition (e.g. Č -> C)
      mapped = mapped.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      try {
        font.encodeText(mapped);
        safeRendered += mapped;
        transliteratedChars.push(`${ch} -> ${mapped}`);
      } catch {
        // Character cannot be represented in WinAnsi (CJK, Cyrillic, Greek, Emoji, etc.)
        safeRendered += '?';
        substitutedChars.push(ch);
      }
    }

    let warning: CharacterEncodingWarning | undefined;
    if (field && (transliteratedChars.length > 0 || substitutedChars.length > 0)) {
      const fallbackType = (transliteratedChars.length > 0 && substitutedChars.length > 0)
        ? 'transliterated_and_substituted'
        : (transliteratedChars.length > 0 ? 'transliterated' : 'substituted');

      const uniqueSubstituted = Array.from(new Set(substitutedChars));
      const uniqueTransliterated = Array.from(new Set(transliteratedChars));

      let msg = '';
      if (uniqueSubstituted.length > 0) {
        msg += `Characters not supported by standard PDF Helvetica were replaced with '?': [${uniqueSubstituted.join(', ')}]. `;
      }
      if (uniqueTransliterated.length > 0) {
        msg += `Accented characters outside WinAnsi were transliterated to base Latin: [${uniqueTransliterated.join(', ')}].`;
      }

      warning = {
        field,
        originalText: text,
        renderedText: safeRendered,
        unsupportedCharacters: Array.from(new Set([...uniqueSubstituted, ...uniqueTransliterated])),
        fallbackType,
        message: msg.trim()
      };
    }

    return {
      hex: `<${font.encodeText(safeRendered).asString()}>`,
      renderedText: safeRendered,
      warning
    };
  }
}
