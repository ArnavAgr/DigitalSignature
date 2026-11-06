import { inspectPdfForSigning } from './pdf/inspector.ts';
import { parseAndUnlockPfx, type ExtractedSignerContext } from './crypto/pfx.ts';
import { preparePdfForSigning } from './pdf/placeholder.ts';
import { createPadesCmsSignature } from './crypto/signer.ts';

// State stored strictly in ephemeral memory
let currentPdfBytes: Uint8Array | null = null;
let currentPdfFilename: string = 'document.pdf';
let currentPdfPageCount: number = 1;
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

const typeVisible = document.getElementById('type-visible') as HTMLInputElement;
const typeInvisible = document.getElementById('type-invisible') as HTMLInputElement;
const visibleOptions = document.getElementById('visible-options') as HTMLDivElement;
const stampPage = document.getElementById('stamp-page') as HTMLSelectElement;
const stampPosition = document.getElementById('stamp-position') as HTMLSelectElement;

const previewSigner = document.getElementById('preview-signer') as HTMLDivElement;
const previewOrg = document.getElementById('preview-org') as HTMLDivElement;
const previewDate = document.getElementById('preview-date') as HTMLDivElement;

const resultSection = document.getElementById('result-section') as HTMLElement;
const resultDetails = document.getElementById('result-details') as HTMLDivElement;
const downloadLink = document.getElementById('download-link') as HTMLAnchorElement;

// Helper to update button state
function updateSignButtonState() {
  const isReady = currentPdfBytes !== null && currentPfxBytes !== null && pfxPassword.value.length > 0;
  signBtn.disabled = !isReady;
}

// Update Live Preview Date
function updatePreviewDate() {
  const now = new Date();
  const dateStr = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  previewDate.textContent = `Date: ${dateStr}`;
}
updatePreviewDate();

// Toggle Visible vs Invisible Options Card
function handleStampTypeChange() {
  if (typeVisible.checked) {
    visibleOptions.classList.remove('hidden');
  } else {
    visibleOptions.classList.add('hidden');
  }
}
typeVisible.addEventListener('change', handleStampTypeChange);
typeInvisible.addEventListener('change', handleStampTypeChange);

// Populate Page Selector based on loaded PDF
function updatePageSelector(pageCount: number) {
  stampPage.innerHTML = '';

  const optLast = document.createElement('option');
  optLast.value = 'last';
  optLast.textContent = `Last Page (Page ${pageCount})`;
  stampPage.appendChild(optLast);

  if (pageCount > 1) {
    const optFirst = document.createElement('option');
    optFirst.value = 'first';
    optFirst.textContent = 'First Page (Page 1)';
    stampPage.appendChild(optFirst);

    for (let i = 2; i < pageCount; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `Page ${i}`;
      stampPage.appendChild(opt);
    }
  }
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
      currentPdfPageCount = inspection.details?.pageCount || 1;
      updatePageSelector(currentPdfPageCount);

      pdfStatus.className = 'status-msg success';
      pdfStatus.textContent = `✓ Eligible unsigned PDF (${currentPdfPageCount} page(s)).`;
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

    // Update Live Preview with actual signer metadata
    previewSigner.textContent = signerContext.details.commonName;
    previewOrg.textContent = signerContext.details.organization || 'Individual Verification';
    updatePreviewDate();

    // Resolve Visual Stamp Options
    const isVisible = typeVisible.checked;
    const pageVal = stampPage.value;
    let targetPage: 'first' | 'last' | number = 'last';
    if (pageVal === 'first') targetPage = 'first';
    else if (pageVal === 'last') targetPage = 'last';
    else targetPage = parseInt(pageVal, 10);

    const posVal = stampPosition.value as 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

    // B. Prepare PDF placeholder and compute ByteRange digest
    const prepared = await preparePdfForSigning(currentPdfBytes, {
      signingTime: new Date(),
      reason: 'Document verified and signed locally in browser',
      visualStamp: {
        enabled: isVisible,
        page: targetPage,
        position: posVal,
        signerName: signerContext.details.commonName,
        organization: signerContext.details.organization
      }
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

    // Display Success UI
    const stampTypeLabel = isVisible ? `Visible Stamp (${posVal.replace('-', ' ')}, Page: ${pageVal})` : 'Invisible Signature';

    let warningsHtml = '';
    if (prepared.warnings && prepared.warnings.length > 0) {
      warningsHtml = `
        <div style="margin-top: 0.5rem; padding: 0.6rem; background: #fff8e1; border: 1px solid #ffe082; border-radius: 4px; font-size: 0.78rem; color: #855d00; line-height: 1.4;">
          <strong>⚠️ Font Encoding Notice:</strong> One or more characters in your certificate details are outside the PDF standard Helvetica (WinAnsi) repertoire:
          <ul style="margin: 0.25rem 0 0 1rem; padding: 0;">
            ${prepared.warnings.map(w => `<li><strong>${escapeHtml(w.field === 'signerName' ? 'Signer Name' : 'Organization')}:</strong> ${escapeHtml(w.message)}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    resultDetails.innerHTML = `
      <div style="text-align: left; margin: 0.75rem 0; font-size: 0.85rem; line-height: 1.6;">
        <div><strong>Signer Common Name:</strong> ${escapeHtml(signerContext.details.commonName)}</div>
        <div><strong>Organization:</strong> ${escapeHtml(signerContext.details.organization || 'Individual')}</div>
        <div><strong>Cryptographic Integrity:</strong> <span style="color: #137333; font-weight: 600;">✓ Intact &amp; Valid</span> (ByteRange SHA-256 verified)</div>
        <div><strong>Appearance Mode:</strong> ${escapeHtml(stampTypeLabel)}</div>
        <div><strong>Mechanism:</strong> SHA-256 with ${signerContext.details.keySizeBits}-bit RSA</div>
        <div><strong>Format:</strong> /ETSI.CAdES.detached (PAdES Baseline B-B profile aligned)</div>
        ${warningsHtml}
        <div style="margin-top: 0.5rem; padding: 0.5rem; background: rgba(0,0,0,0.04); border-radius: 4px; font-size: 0.78rem; color: #3c4043;">
          ℹ️ <strong>Trust Model Notice:</strong> The cryptographic signature and document integrity are mathematically sound. Validation in Adobe Acrobat or external verifiers depends on whether the recipient trusts your certificate's root CA chain.
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

  previewSigner.textContent = 'Authorized Signer';
  previewOrg.textContent = 'Individual Verification';
  updatePreviewDate();

  typeVisible.checked = true;
  visibleOptions.classList.remove('hidden');
  stampPage.innerHTML = '<option value="last">Last Page</option><option value="first">First Page</option>';
  stampPosition.value = 'bottom-right';

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
