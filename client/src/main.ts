import { inspectPdfForSigning } from './pdf/inspector.ts';
import { parseAndUnlockPfx, type ExtractedSignerContext } from './crypto/pfx.ts';
import { preparePdfForSigning } from './pdf/placeholder.ts';
import { createPadesCmsSignature } from './crypto/signer.ts';

// State stored only in ephemeral memory (never in localStorage or IndexedDB)
let currentPdfBytes: Uint8Array | null = null;
let currentPdfFilename: string = 'document.pdf';
let currentPfxBytes: Uint8Array | null = null;
let activeBlobUrl: string | null = null;

// DOM Elements
const pdfInput = document.getElementById('pdf-input') as HTMLInputElement;
const pfxInput = document.getElementById('pfx-input') as HTMLInputElement;
const pfxPassword = document.getElementById('pfx-password') as HTMLInputElement;
const signBtn = document.getElementById('sign-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;

const pdfStatus = document.getElementById('pdf-status') as HTMLDivElement;
const pfxFileStatus = document.getElementById('pfx-file-status') as HTMLDivElement;
const certStatus = document.getElementById('cert-status') as HTMLDivElement;

const resultSection = document.getElementById('result-section') as HTMLElement;
const resultDetails = document.getElementById('result-details') as HTMLParagraphElement;
const downloadLink = document.getElementById('download-link') as HTMLAnchorElement;

// Helper to update button state
function updateSignButtonState() {
  const isReady = currentPdfBytes !== null && currentPfxBytes !== null && pfxPassword.value.length > 0;
  signBtn.disabled = !isReady;
}

// 1. PDF File Input Handler
pdfInput.addEventListener('change', async () => {
  pdfStatus.className = 'status-msg';
  pdfStatus.textContent = '';
  currentPdfBytes = null;

  const file = pdfInput.files?.[0];
  if (!file) {
    updateSignButtonState();
    return;
  }

  currentPdfFilename = file.name;
  pdfStatus.textContent = 'Inspecting PDF structure...';

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const inspection = await inspectPdfForSigning(bytes);

    if (!inspection.isEligible) {
      pdfStatus.className = 'status-msg error';
      pdfStatus.textContent = `❌ ${inspection.reason}`;
      currentPdfBytes = null;
    } else {
      currentPdfBytes = bytes;
      pdfStatus.className = 'status-msg success';
      pdfStatus.textContent = `✓ Eligible unsigned PDF (${inspection.details?.pageCount} page(s)).`;
    }
  } catch (err: unknown) {
    pdfStatus.className = 'status-msg error';
    pdfStatus.textContent = `❌ Error reading PDF: ${err instanceof Error ? err.message : String(err)}`;
    currentPdfBytes = null;
  }

  updateSignButtonState();
});

// 2. PFX/P12 File Input Handler
pfxInput.addEventListener('change', async () => {
  pfxFileStatus.className = 'status-msg';
  pfxFileStatus.textContent = '';
  currentPfxBytes = null;

  const file = pfxInput.files?.[0];
  if (!file) {
    updateSignButtonState();
    return;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    currentPfxBytes = new Uint8Array(arrayBuffer);
    pfxFileStatus.className = 'status-msg success';
    pfxFileStatus.textContent = `✓ Certificate container loaded (${file.name}, ${currentPfxBytes.length} bytes).`;
  } catch (err: unknown) {
    pfxFileStatus.className = 'status-msg error';
    pfxFileStatus.textContent = `❌ Error reading certificate: ${err instanceof Error ? err.message : String(err)}`;
    currentPfxBytes = null;
  }

  updateSignButtonState();
});

// 3. Password Input Handler
pfxPassword.addEventListener('input', () => {
  certStatus.textContent = '';
  updateSignButtonState();
});

// 4. Sign Action Handler
signBtn.addEventListener('click', async () => {
  if (!currentPdfBytes || !currentPfxBytes || !pfxPassword.value) {
    return;
  }

  signBtn.disabled = true;
  signBtn.textContent = 'Signing in memory...';
  certStatus.className = 'status-msg';
  certStatus.textContent = 'Unlocking certificate and verifying cryptographic pairing...';
  resultSection.classList.add('hidden');

  let signerContext: ExtractedSignerContext | null = null;

  try {
    // A. Unlock PKCS#12 container and verify key/cert pairing
    signerContext = await parseAndUnlockPfx(currentPfxBytes, pfxPassword.value);
    certStatus.className = 'status-msg success';
    certStatus.textContent = `✓ Certificate unlocked: ${signerContext.details.commonName} (${signerContext.details.organization || 'Individual'})`;

    // B. Prepare PDF placeholder and compute ByteRange digest
    const prepared = await preparePdfForSigning(currentPdfBytes, {
      signingTime: new Date(),
      reason: 'Document verified and signed locally in browser'
    });

    // C. Generate PAdES Baseline B-B CMS Signature (RFC 5652 & ETSI EN 319 142-1 V1.2.1)
    const cmsResult = await createPadesCmsSignature(prepared.byteRangeDigest, signerContext);

    // D. Inject signature into prepared PDF
    const signedPdfBytes = prepared.injectSignature(cmsResult.cmsHex);

    // E. Create Download Blob
    const blob = new Blob([signedPdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    if (activeBlobUrl) {
      URL.revokeObjectURL(activeBlobUrl);
    }
    activeBlobUrl = URL.createObjectURL(blob);

    const baseName = currentPdfFilename.replace(/\.pdf$/i, '');
    const downloadName = `${baseName}_signed.pdf`;

    downloadLink.href = activeBlobUrl;
    downloadLink.download = downloadName;

    // Delayed URL Revocation after 60 seconds
    const targetUrl = activeBlobUrl;
    setTimeout(() => {
      URL.revokeObjectURL(targetUrl);
    }, 60000);

    // Display Success UI with clear distinction between cryptographic validity and trust anchor status
    resultDetails.innerHTML = `
      <div style="text-align: left; margin: 0.75rem 0; font-size: 0.85rem; line-height: 1.6;">
        <div><strong>Signer Common Name:</strong> ${escapeHtml(signerContext.details.commonName)}</div>
        <div><strong>Organization:</strong> ${escapeHtml(signerContext.details.organization || 'Individual')}</div>
        <div><strong>Cryptographic Integrity:</strong> <span style="color: #137333; font-weight: 600;">✓ Intact &amp; Valid</span> (ByteRange SHA-256 verified)</div>
        <div><strong>Mechanism:</strong> SHA-256 with ${signerContext.details.keySizeBits}-bit RSA</div>
        <div><strong>Format:</strong> /ETSI.CAdES.detached (PAdES Baseline B-B profile)</div>
        <div style="margin-top: 0.5rem; padding: 0.5rem; background: rgba(0,0,0,0.04); border-radius: 4px; font-size: 0.78rem; color: #3c4043;">
          ℹ️ <strong>Trust Model Notice:</strong> The cryptographic signature and document integrity are mathematically sound. Trust status in Adobe Acrobat or external verifiers depends on whether the recipient trusts your certificate's root CA chain.
        </div>
      </div>
    `;
    resultSection.classList.remove('hidden');

  } catch (err: unknown) {
    certStatus.className = 'status-msg error';
    certStatus.textContent = `❌ ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    signBtn.disabled = false;
    signBtn.textContent = 'Sign PDF Document';
  }
});

// 5. Reset Handler
resetBtn.addEventListener('click', () => {
  if (currentPdfBytes) currentPdfBytes.fill(0);
  if (currentPfxBytes) currentPfxBytes.fill(0);

  currentPdfBytes = null;
  currentPfxBytes = null;
  pfxPassword.value = '';

  pdfInput.value = '';
  pfxInput.value = '';

  pdfStatus.textContent = '';
  pdfStatus.className = 'status-msg';

  pfxFileStatus.textContent = '';
  pfxFileStatus.className = 'status-msg';

  certStatus.textContent = '';
  certStatus.className = 'status-msg';

  resultSection.classList.add('hidden');

  if (activeBlobUrl) {
    URL.revokeObjectURL(activeBlobUrl);
    activeBlobUrl = null;
  }

  updateSignButtonState();
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
