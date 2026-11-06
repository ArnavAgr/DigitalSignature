import fs from 'node:fs';
import { parseAndUnlockPfx } from '../src/crypto/pfx.ts';
import { inspectPdfForSigning } from '../src/pdf/inspector.ts';

async function testErrors() {
  console.log('--- Testing Error Trapping & Safety ---');

  // Test 1: Incorrect Password
  const pfxBuf = fs.readFileSync('test_synthetic.pfx');
  try {
    await parseAndUnlockPfx(new Uint8Array(pfxBuf), 'WrongPassword123');
    console.error('FAIL: Unlocked with wrong password');
  } catch (err: any) {
    console.log('PASS (Wrong Password):', err.message);
  }

  // Test 2: Corrupted PFX Container
  const corruptPfx = new Uint8Array([0x30, 0x82, 0x01, 0x00, 0xFF, 0xEE]);
  try {
    await parseAndUnlockPfx(corruptPfx, 'TestPassword123!');
    console.error('FAIL: Unlocked corrupt container');
  } catch (err: any) {
    console.log('PASS (Corrupted PFX):', err.message);
  }

  // Test 3: Corrupted / Non-PDF file
  const nonPdf = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]);
  const pdfRes = await inspectPdfForSigning(nonPdf);
  console.log('PASS (Invalid PDF Header):', pdfRes.isEligible ? 'FAIL' : 'REJECTED:', pdfRes.reason);

  // Test 4: Signed PDF rejection
  const signedPdf = fs.readFileSync('signed_synthetic_output.pdf');
  const signedRes = await inspectPdfForSigning(new Uint8Array(signedPdf));
  console.log('PASS (Signed PDF Rejection):', signedRes.isEligible ? 'FAIL' : 'REJECTED:', signedRes.reason);
}

testErrors().catch(console.error);

