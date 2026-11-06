import os
import subprocess
import fitz

QA_DIR = os.path.abspath('client/qa_output')
TRUST_ANCHOR = os.path.abspath('client/test_synthetic_trust.pem')
PYHANKO_PATH = os.path.abspath('myenv/Scripts/pyhanko.exe')

def run_qa_verification():
    print('==============================================================================')
    print('          COMPREHENSIVE VISUAL & CRYPTOGRAPHIC QA VERIFICATION SUITE         ')
    print('==============================================================================\n')

    pdf_files = sorted([f for f in os.listdir(QA_DIR) if f.endswith('.pdf')])
    if not pdf_files:
        print('No PDF files found in', QA_DIR)
        return

    results = []

    for fname in pdf_files:
        fpath = os.path.join(QA_DIR, fname)
        base_id = fname.replace('.pdf', '')
        print(f'--> Inspecting [{fname}]...')

        # 1. PyMuPDF Inspection & Rasterization
        doc = fitz.open(fpath)
        page_count = len(doc)
        
        # Check target page (usually the page with signature)
        sig_page_idx = None
        sig_widget = None
        for p_idx in range(page_count):
            p = doc[p_idx]
            for w in p.widgets():
                if w.field_type == 6 or w.field_name == 'Signature1':
                    sig_page_idx = p_idx
                    sig_widget = w
                    break
            if sig_widget:
                break

        if sig_widget is None:
            print(f'   ERROR: No signature widget found in {fname}!')
            results.append((fname, False, 'No signature widget', 'FAIL'))
            continue

        target_page = doc[sig_page_idx]
        visual_rect = target_page.rect
        rotation = target_page.rotation
        w_rect = sig_widget.rect

        # Render page to PNG
        png_name = f'{base_id}_rendered.png'
        png_path = os.path.join(QA_DIR, png_name)
        pix = target_page.get_pixmap(dpi=150)
        pix.save(png_path)

        # 2. PyHanko Cryptographic AdES Verification
        pyhanko_cmd = [
            PYHANKO_PATH,
            'sign',
            'adesverify',
            '--trust',
            TRUST_ANCHOR,
            fpath
        ]
        ades_proc = subprocess.run(pyhanko_cmd, capture_output=True, text=True)
        ades_stdout = ades_proc.stdout + ades_proc.stderr

        is_intact = 'INTACT' in ades_stdout
        is_trusted = 'TRUSTED' in ades_stdout
        is_untouched = 'UNTOUCHED' in ades_stdout
        ades_valid = (ades_proc.returncode == 0) and is_intact and is_trusted and is_untouched

        # Also run pretty-print to verify byte coverage message
        pyhanko_pp_cmd = [
            PYHANKO_PATH,
            'sign',
            'adesverify',
            '--trust',
            TRUST_ANCHOR,
            '--pretty-print',
            fpath
        ]
        ades_pp_proc = subprocess.run(pyhanko_pp_cmd, capture_output=True, text=True)
        covers_entire_file = 'The signature covers the entire file' in ades_pp_proc.stdout
        signature_judged_valid = 'The signature is judged VALID' in ades_pp_proc.stdout

        all_crypto_pass = ades_valid and covers_entire_file and signature_judged_valid

        print(f'   Pages: {page_count}, Sig Page: {sig_page_idx + 1}, Rotation: {rotation}°')
        print(f'   Visual Page Rect: {visual_rect.width}x{visual_rect.height} pt')
        print(f'   Widget Rect: [{w_rect.x0:.1f}, {w_rect.y0:.1f}, {w_rect.x1:.1f}, {w_rect.y1:.1f}] (w={w_rect.width:.1f}, h={w_rect.height:.1f})')
        print(f'   Rendered Pixmap: {pix.width}x{pix.height} px -> {png_name}')
        print(f'   Crypto: Intact={is_intact}, Trusted={is_trusted}, CoversFile={covers_entire_file}, Status={"PASS" if all_crypto_pass else "FAIL"}')

        results.append({
            'file': fname,
            'page_count': page_count,
            'sig_page': sig_page_idx + 1,
            'rotation': rotation,
            'width': visual_rect.width,
            'height': visual_rect.height,
            'widget_w': w_rect.width,
            'widget_h': w_rect.height,
            'covers_file': covers_entire_file,
            'ades_valid': all_crypto_pass
        })
        print()

    # Summary Table
    print('==============================================================================')
    print('                          QA SUITE VERIFICATION MATRIX                        ')
    print('==============================================================================')
    header = f'{"Test File":<32} | {"Pgs":<3} | {"Rot":<4} | {"Page Size":<13} | {"Stamp Size":<12} | {"Covers":<6} | {"AdES Status":<10}'
    print(header)
    print('-' * len(header))
    for r in results:
        status_str = 'PASS (VALID)' if r['ades_valid'] else 'FAIL'
        covers_str = 'YES' if r['covers_file'] else 'NO'
        dim_str = f'{r["width"]:.0f}x{r["height"]:.0f}'
        stamp_str = f'{r["widget_w"]:.0f}x{r["widget_h"]:.0f}'
        print(f'{r["file"]:<32} | {r["page_count"]:<3} | {r["rotation"]:>3}° | {dim_str:<13} | {stamp_str:<12} | {covers_str:<6} | {status_str:<10}')
    print('==============================================================================')

if __name__ == '__main__':
    run_qa_verification()

