import fs from 'node:fs';
import { parseAndUnlockPfx } from '../src/crypto/pfx.ts';
import { preparePdfForSigning } from '../src/pdf/placeholder.ts';
import { createPadesCmsSignature } from '../src/crypto/signer.ts';

async function testVisibleAndInvisible() {
  console.log('=== Running End-to-End Tests for Visible & Invisible Signatures ===');

  const pdfPath = '../Testing/emptydoc.pdf';
  const pdfBytes = new Uint8Array(fs.readFileSync(pdfPath));

  const pfxBuf = fs.readFileSync('test_synthetic.pfx');
  const signerContext = await parseAndUnlockPfx(new Uint8Array(pfxBuf), 'TestPassword123!');

  // Test 1: Visible Signature Stamp (Bottom-Right, Last Page)
  console.log('\n--- 1. Generating Visible Signature ---');
  const visiblePrepared = await preparePdfForSigning(pdfBytes, {
    signingTime: new Date(),
    visualStamp: {
      enabled: true,
      page: 'last',
      position: 'bottom-right',
      signerName: signerContext.details.commonName,
      organization: signerContext.details.organization,
    }
  });

  const visibleCms = await createPadesCmsSignature(visiblePrepared.byteRangeDigest, signerContext);
  const visibleSignedPdf = visiblePrepared.injectSignature(visibleCms.cmsHex);
  fs.writeFileSync('signed_visible_test.pdf', Buffer.from(visibleSignedPdf));
  console.log('Saved signed_visible_test.pdf:', visibleSignedPdf.length, 'bytes');

  // Test 2: Invisible Signature
  console.log('\n--- 2. Generating Invisible Signature ---');
  const invisiblePrepared = await preparePdfForSigning(pdfBytes, {
    signingTime: new Date(),
    visualStamp: {
      enabled: false,
      signerName: signerContext.details.commonName
    }
  });

  const invisibleCms = await createPadesCmsSignature(invisiblePrepared.byteRangeDigest, signerContext);
  const invisibleSignedPdf = invisiblePrepared.injectSignature(invisibleCms.cmsHex);
  fs.writeFileSync('signed_invisible_test.pdf', Buffer.from(invisibleSignedPdf));
  console.log('Saved signed_invisible_test.pdf:', invisibleSignedPdf.length, 'bytes');
}

testVisibleAndInvisible().catch(console.error);

