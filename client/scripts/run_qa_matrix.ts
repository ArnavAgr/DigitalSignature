import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { parseAndUnlockPfx } from '../src/crypto/pfx.ts';
import { preparePdfForSigning } from '../src/pdf/placeholder.ts';
import type { VisualStampOptions } from '../src/pdf/placeholder.ts';
import { createPadesCmsSignature } from '../src/crypto/signer.ts';

interface TestCase {
  id: string;
  description: string;
  createBasePdf: () => Promise<Uint8Array>;
  stampOptions: {
    enabled: boolean;
    page?: 'first' | 'last' | number;
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    signerName?: string;
    organization?: string;
  };
}

async function main() {
  console.log('================================================================');
  console.log('       STARTING COMPREHENSIVE QA TEST MATRIX GENERATION        ');
  console.log('================================================================\n');

  const pfxBuf = fs.readFileSync('test_synthetic.pfx');
  const signerContext = await parseAndUnlockPfx(new Uint8Array(pfxBuf), 'TestPassword123!');
  console.log(`Unlocked PFX for signer: "${signerContext.details.commonName}" (${signerContext.details.organization})\n`);

  const outputDir = path.resolve('qa_output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const testCases: TestCase[] = [
    {
      id: 'tc1_single_a4_portrait_br',
      description: 'Single-page A4 Portrait with bottom-right preset',
      createBasePdf: async () => {
        const doc = await PDFDocument.create();
        doc.addPage([595.28, 841.89]); // A4
        return await doc.save();
      },
      stampOptions: {
        enabled: true,
        page: 'last',
        position: 'bottom-right'
      }
    },
    {
      id: 'tc2_multipage_letter_tr',
      description: '3-Page US Letter with top-right preset on page 3',
      createBasePdf: async () => {
        const doc = await PDFDocument.create();
        doc.addPage([612, 792]); // Letter Page 1
        doc.addPage([612, 792]); // Letter Page 2
        doc.addPage([612, 792]); // Letter Page 3
        return await doc.save();
      },
      stampOptions: {
        enabled: true,
        page: 3,
        position: 'top-right'
      }
    },
    {
      id: 'tc3_landscape_a4_bl',
      description: 'Landscape A4 page with bottom-left preset',
      createBasePdf: async () => {
        const doc = await PDFDocument.create();
        doc.addPage([841.89, 595.28]); // Landscape A4
        return await doc.save();
      },
      stampOptions: {
        enabled: true,
        page: 1,
        position: 'bottom-left'
      }
    },
    {
      id: 'tc4_rot_90_tl',
      description: 'Rotated 90 degrees page with top-left preset',
      createBasePdf: async () => {
        const doc = await PDFDocument.create();
        const p = doc.addPage([595.28, 841.89]);
        p.setRotation(degrees(90));
        return await doc.save();
      },
      stampOptions: {
        enabled: true,
        page: 1,
        position: 'top-left'
      }
    },
    {
      id: 'tc5_rot_180_br',
      description: 'Rotated 180 degrees page with bottom-right preset',
      createBasePdf: async () => {
        const doc = await PDFDocument.create();
        const p = doc.addPage([595.28, 841.89]);
        p.setRotation(degrees(180));
        return await doc.save();
      },
      stampOptions: {
        enabled: true,
        page: 1,
        position: 'bottom-right'
      }
    },
    {
      id: 'tc6_rot_270_bl',
      description: 'Rotated 270 degrees page with bottom-left preset',
      createBasePdf: async () => {
        const doc = await PDFDocument.create();
        const p = doc.addPage([595.28, 841.89]);
        p.setRotation(degrees(270));
        return await doc.save();
      },
      stampOptions: {
        enabled: true,
        page: 1,
        position: 'bottom-left'
      }
    },
    {
      id: 'tc7_existing_form_fields_br',
      description: 'PDF with existing AcroForm text box & checkbox with bottom-right preset',
      createBasePdf: async () => {
        const doc = await PDFDocument.create();
        const page = doc.addPage([595.28, 841.89]);
        const form = doc.getForm();
        const tf = form.createTextField('tax_id_number');
        tf.setText('TAX-98765-AB');
        tf.addToPage(page, { x: 50, y: 720, width: 220, height: 25 });
        const cb = form.createCheckBox('certify_declaration');
        cb.check();
        cb.addToPage(page, { x: 50, y: 670, width: 18, height: 18 });
        return await doc.save();
      },
      stampOptions: {
        enabled: true,
        page: 'last',
        position: 'bottom-right'
      }
    },
    {
      id: 'tc8_non_ascii_unicode_br',
      description: 'Non-ASCII certificate text: French accents & German umlauts',
      createBasePdf: async () => {
        const doc = await PDFDocument.create();
        doc.addPage([595.28, 841.89]);
        return await doc.save();
      },
      stampOptions: {
        enabled: true,
        page: 1,
        position: 'bottom-right',
        signerName: 'Dr. René François Müller-DuPont',
        organization: 'Crédit Agricole S.A. & Jørgensen Café'
      }
    },
    {
      id: 'tc9_preset_top_left',
      description: 'Top-left preset verification on A4 Portrait',
      createBasePdf: async () => {
        const doc = await PDFDocument.create();
        doc.addPage([595.28, 841.89]);
        return await doc.save();
      },
      stampOptions: {
        enabled: true,
        page: 1,
        position: 'top-left'
      }
    },
    {
      id: 'tc10_preset_bottom_left',
      description: 'Bottom-left preset verification on A4 Portrait',
      createBasePdf: async () => {
        const doc = await PDFDocument.create();
        doc.addPage([595.28, 841.89]);
        return await doc.save();
      },
      stampOptions: {
        enabled: true,
        page: 1,
        position: 'bottom-left'
      }
    },
    {
      id: 'tc11_preset_top_right',
      description: 'Top-right preset verification on A4 Portrait',
      createBasePdf: async () => {
        const doc = await PDFDocument.create();
        doc.addPage([595.28, 841.89]);
        return await doc.save();
      },
      stampOptions: {
        enabled: true,
        page: 1,
        position: 'top-right'
      }
    },
    {
      id: 'tc12_unsupported_char_warning_br',
      description: 'Explicit warning validation for characters outside standard PDF font (CJK/Transliteration)',
      createBasePdf: async () => {
        const doc = await PDFDocument.create();
        doc.addPage([595.28, 841.89]);
        return await doc.save();
      },
      stampOptions: {
        enabled: true,
        page: 1,
        position: 'bottom-right',
        signerName: '山田太郎 (Yamada Taro)',
        organization: 'Tokyo Operations Ltd & Łukasz'
      }
    }
  ];

  for (const tc of testCases) {
    console.log(`[TEST CASE] Generating: ${tc.id} - ${tc.description}...`);
    const baseBytes = await tc.createBasePdf();

    const stampOpts: VisualStampOptions = {
      enabled: tc.stampOptions.enabled,
      page: tc.stampOptions.page,
      position: tc.stampOptions.position,
      signerName: tc.stampOptions.signerName || signerContext.details.commonName,
      organization: tc.stampOptions.organization || signerContext.details.organization,
    };

    const prepared = await preparePdfForSigning(baseBytes, {
      signingTime: new Date(),
      visualStamp: stampOpts
    });

    if (prepared.warnings.length > 0) {
      console.log(`  -> Detected ${prepared.warnings.length} font encoding warnings:`);
      for (const w of prepared.warnings) {
        console.log(`     [${w.field}] ${w.message} (Rendered: "${w.renderedText}")`);
      }
    }

    const cms = await createPadesCmsSignature(prepared.byteRangeDigest, signerContext);
    const signedPdf = prepared.injectSignature(cms.cmsHex);

    const outPath = path.join(outputDir, `${tc.id}.pdf`);
    fs.writeFileSync(outPath, Buffer.from(signedPdf));
    console.log(`  -> Wrote ${signedPdf.length} bytes to ${outPath}\n`);
  }

  console.log('All QA matrix test cases successfully generated!');
}

main().catch((err) => {
  console.error('Fatal error during QA matrix generation:', err);
  process.exit(1);
});
