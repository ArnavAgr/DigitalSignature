/**
 * Structural PDF Revision & Cross-Reference Chain Inspector.
 * 
 * According to ISO 32000-1 (Sections 7.5.5, 7.5.6, and 7.5.8.4):
 * - Documents consist of one or more revisions terminated by %%EOF.
 * - Each revision points to a cross-reference table (xref) or cross-reference stream (/Type /XRef).
 * - Multi-revision documents chain previous revisions via the /Prev entry in the trailer.
 * - Note on Hybrid-Reference Files (ISO 32000-1 7.5.8.4):
 *   A single revision may contain both a cross-reference table and a cross-reference stream,
 *   where the trailer contains /XRefStm alongside /Prev pointing to the companion stream.
 *   This is a dual representation of a single revision, not an incremental update.
 */

export interface RevisionAnalysis {
  revisionCount: number;
  hasIncrementalUpdates: boolean;
  isHybridReference: boolean;
  reasons: string[];
}

export function analyzePdfRevisions(pdfBytes: Uint8Array): RevisionAnalysis {
  const textDecoder = new TextDecoder('latin1');
  const content = textDecoder.decode(pdfBytes);

  // Find all %%EOF occurrences
  const eofRegex = /%%EOF/g;
  const eofMatches = [...content.matchAll(eofRegex)];
  const eofCount = eofMatches.length;

  if (eofCount === 0) {
    return {
      revisionCount: 0,
      hasIncrementalUpdates: false,
      isHybridReference: false,
      reasons: ['No %%EOF marker found in document. File may be truncated or corrupted.']
    };
  }

  // Scan backwards from the end of the file for the final startxref
  const startXrefRegex = /startxref\s+(\d+)\s+%%EOF/g;
  const startXrefMatches = [...content.matchAll(startXrefRegex)];

  if (startXrefMatches.length === 0) {
    return {
      revisionCount: 0,
      hasIncrementalUpdates: false,
      isHybridReference: false,
      reasons: ['No startxref marker found preceding %%EOF.']
    };
  }

  // Follow the /Prev trailer chain starting from the last startxref
  let currentOffset = parseInt(startXrefMatches[startXrefMatches.length - 1][1], 10);
  let chainHops = 0;
  let isHybrid = false;
  const visitedOffsets = new Set<number>();
  const reasons: string[] = [];

  while (currentOffset > 0 && !visitedOffsets.has(currentOffset) && chainHops < 50) {
    visitedOffsets.add(currentOffset);
    chainHops++;

    // Look for trailer dictionary around currentOffset
    // In traditional xref, 'trailer' keyword follows the table.
    // In cross-reference stream (/Type /XRef), the dictionary is right at the object definition.
    const slice = content.slice(currentOffset, Math.min(currentOffset + 4096, content.length));
    
    // Check if this trailer has /XRefStm (hybrid cross-reference)
    if (slice.includes('/XRefStm')) {
      isHybrid = true;
    }

    // Check for /Prev entry
    const prevMatch = slice.match(/\/Prev\s+(\d+)/);
    if (prevMatch) {
      const prevOffset = parseInt(prevMatch[1], 10);
      
      // If /XRefStm is present in this trailer, check if /Prev is pointing to the companion stream
      // within the same revision (Hybrid Reference file)
      if (isHybrid && chainHops === 1 && slice.includes('/XRefStm')) {
        // Hybrid companion link
        currentOffset = prevOffset;
        continue;
      }

      // Legitimate previous revision hop
      reasons.push(`Found previous revision pointer /Prev ${prevOffset}.`);
      currentOffset = prevOffset;
    } else {
      break; // Reached initial revision
    }
  }

  // If we had a hybrid reference companion hop, normalize effective revision count
  const effectiveRevisions = isHybrid && chainHops > 1 ? chainHops - 1 : chainHops;
  const hasIncrementalUpdates = effectiveRevisions > 1;

  if (hasIncrementalUpdates) {
    reasons.push(`Document contains ${effectiveRevisions} distinct incremental revisions.`);
  }

  return {
    revisionCount: effectiveRevisions,
    hasIncrementalUpdates,
    isHybridReference: isHybrid,
    reasons
  };
}

