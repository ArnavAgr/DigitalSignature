import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from 'pdf-lib';
import { analyzePdfRevisions } from './revisions.ts';

export interface InspectionResult {
  isEligible: boolean;
  reason?: string;
  details?: {
    pageCount: number;
    hasAcroForm: boolean;
    sigFlags?: number;
    signaturesExistFlag?: boolean;
    appendOnlyFlag?: boolean;
    revisionCount: number;
    isHybridReference: boolean;
  };
}

/**
 * Structural Pre-Flight Inspector for PDFs.
 * 
 * Inspects document AST (Catalog -> AcroForm -> Fields) and cross-reference structures.
 * Fails closed on any ambiguity, encryption, existing signatures, or multi-revision history.
 */
export async function inspectPdfForSigning(pdfBytes: Uint8Array): Promise<InspectionResult> {
  // Fail-closed sanity check on PDF header
  if (pdfBytes.byteLength < 32) {
    return { isEligible: false, reason: 'File is too small to be a valid PDF document.' };
  }

  const header = String.fromCharCode(...pdfBytes.subarray(0, 8));
  if (!header.startsWith('%PDF-')) {
    return { isEligible: false, reason: 'File header does not match PDF specification (%PDF-).' };
  }

  // 1. Structural Revision Analysis (following xref/trailer /Prev chains & hybrid files)
  const revAnalysis = analyzePdfRevisions(pdfBytes);
  if (revAnalysis.revisionCount === 0) {
    return {
      isEligible: false,
      reason: `Corrupted document structure: ${revAnalysis.reasons.join(' ')}`
    };
  }

  if (revAnalysis.hasIncrementalUpdates) {
    return {
      isEligible: false,
      reason: `Document contains ${revAnalysis.revisionCount} incremental revisions. For safety, this MVP only supports pristine single-revision PDFs.`,
      details: {
        pageCount: 0,
        hasAcroForm: false,
        revisionCount: revAnalysis.revisionCount,
        isHybridReference: revAnalysis.isHybridReference
      }
    };
  }

  // 2. AST Parsing via pdf-lib
  let pdfDoc: PDFDocument;
  try {
    // Attempt AST parsing. ignoreEncryption: false ensures encrypted PDFs throw immediately.
    pdfDoc = await PDFDocument.load(pdfBytes, {
      ignoreEncryption: false,
      parseSpeed: 0 // thorough parsing
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('encrypt')) {
      return { isEligible: false, reason: 'Encrypted or password-protected PDFs are not supported.' };
    }
    return {
      isEligible: false,
      reason: `PDF structural parsing failed (fail-closed): ${message}`
    };
  }

  if (pdfDoc.isEncrypted) {
    return { isEligible: false, reason: 'PDF is encrypted or password-protected.' };
  }

  const catalog = pdfDoc.catalog;
  const acroFormObj = catalog.get(PDFName.of('AcroForm'));
  const pageCount = pdfDoc.getPageCount();

  if (!acroFormObj) {
    // Clean document with no AcroForm
    return {
      isEligible: true,
      details: {
        pageCount,
        hasAcroForm: false,
        revisionCount: revAnalysis.revisionCount,
        isHybridReference: revAnalysis.isHybridReference
      }
    };
  }

  // Resolve AcroForm dictionary
  let acroFormDict: PDFDict | null = null;
  if (acroFormObj instanceof PDFRef) {
    const resolved = pdfDoc.context.lookup(acroFormObj);
    if (resolved instanceof PDFDict) acroFormDict = resolved;
  } else if (acroFormObj instanceof PDFDict) {
    acroFormDict = acroFormObj;
  }

  if (!acroFormDict) {
    return {
      isEligible: false,
      reason: 'Malformed AcroForm structure in PDF catalog.'
    };
  }

  // Check /SigFlags specifically
  // Bit 1 (1): SignaturesExist - specifies document contains one or more signatures
  // Bit 2 (2): AppendOnly - specifies document changes are restricted to append-only mode
  const sigFlagsObj = acroFormDict.get(PDFName.of('SigFlags'));
  let sigFlags = 0;
  let signaturesExistFlag = false;
  let appendOnlyFlag = false;

  if (sigFlagsObj) {
    const rawVal = pdfDoc.context.lookup(sigFlagsObj);
    if (typeof (rawVal as any)?.asNumber === 'function') {
      sigFlags = (rawVal as any).asNumber();
      signaturesExistFlag = (sigFlags & 1) !== 0;
      appendOnlyFlag = (sigFlags & 2) !== 0;

      if (signaturesExistFlag) {
        return {
          isEligible: false,
          reason: 'Document AcroForm specifies SigFlags bit 1 (SignaturesExist: at least one digital signature already exists).',
          details: {
            pageCount,
            hasAcroForm: true,
            sigFlags,
            signaturesExistFlag,
            appendOnlyFlag,
            revisionCount: revAnalysis.revisionCount,
            isHybridReference: revAnalysis.isHybridReference
          }
        };
      }

      if (appendOnlyFlag) {
        return {
          isEligible: false,
          reason: 'Document AcroForm specifies SigFlags bit 2 (AppendOnly: document restricts changes to append-only mode).',
          details: {
            pageCount,
            hasAcroForm: true,
            sigFlags,
            signaturesExistFlag,
            appendOnlyFlag,
            revisionCount: revAnalysis.revisionCount,
            isHybridReference: revAnalysis.isHybridReference
          }
        };
      }
    }
  }

  // Recursively inspect /Fields tree for /FT == /Sig or /V with /Type /Sig
  const fieldsObj = acroFormDict.get(PDFName.of('Fields'));
  if (fieldsObj) {
    const fieldsArray = pdfDoc.context.lookup(fieldsObj);
    if (fieldsArray instanceof PDFArray) {
      const hasSignatureField = checkFieldsRecursively(fieldsArray, pdfDoc.context);
      if (hasSignatureField) {
        return {
          isEligible: false,
          reason: 'Document contains one or more signature fields (/FT /Sig). Documents with existing signature fields are not supported in MVP.',
          details: {
            pageCount,
            hasAcroForm: true,
            sigFlags,
            signaturesExistFlag,
            appendOnlyFlag,
            revisionCount: revAnalysis.revisionCount,
            isHybridReference: revAnalysis.isHybridReference
          }
        };
      }
    }
  }

  return {
    isEligible: true,
    details: {
      pageCount,
      hasAcroForm: true,
      sigFlags,
      signaturesExistFlag,
      appendOnlyFlag,
      revisionCount: revAnalysis.revisionCount,
      isHybridReference: revAnalysis.isHybridReference
    }
  };
}

/**
 * Traverses PDF form field hierarchy to detect /FT /Sig or existing /V signature dictionaries.
 */
function checkFieldsRecursively(fieldsArray: PDFArray, context: any): boolean {
  for (let i = 0; i < fieldsArray.size(); i++) {
    const fieldRef = fieldsArray.get(i);
    const fieldDict = context.lookup(fieldRef);
    if (!(fieldDict instanceof PDFDict)) continue;

    const ft = fieldDict.get(PDFName.of('FT'));
    if (ft && context.lookup(ft) === PDFName.of('Sig')) {
      return true; // Found signature field
    }

    const v = fieldDict.get(PDFName.of('V'));
    if (v) {
      const vDict = context.lookup(v);
      if (vDict instanceof PDFDict) {
        const typeObj = vDict.get(PDFName.of('Type'));
        if (typeObj && context.lookup(typeObj) === PDFName.of('Sig')) {
          return true;
        }
      }
    }

    const kidsObj = fieldDict.get(PDFName.of('Kids'));
    if (kidsObj) {
      const kidsArray = context.lookup(kidsObj);
      if (kidsArray instanceof PDFArray) {
        if (checkFieldsRecursively(kidsArray, context)) {
          return true;
        }
      }
    }
  }
  return false;
}
