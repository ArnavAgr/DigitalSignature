from fastapi import FastAPI, File, UploadFile, HTTPException
import os
import tempfile
from datetime import datetime
from pyhanko.sign import signers, fields, PdfSigner, PdfSignatureMetadata
from pyhanko.stamp import TextStampStyle
from pyhanko.pdf_utils.text import TextBoxStyle
from pyhanko.pdf_utils.font import opentype
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.hazmat.primitives import serialization

app = FastAPI()
UPLOAD_DIR = "uploads"

PFX_FILE = "Test_Doc_Pro.pfx"
PFX_PASSWORD = "Pro123"
FONT_FILE = "C:/Windows/Fonts/calibri.ttf"
font_engine = opentype.GlyphAccumulatorFactory(FONT_FILE)

@app.post("/sign/file")
async def sign_uploaded_pdf(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    try:
        # 1. Save uploaded file temporarily
        pdf_bytes = await file.read()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        temp_input_path = os.path.join(UPLOAD_DIR, f"temp_input_{timestamp}.pdf")
        with open(temp_input_path, "wb") as temp_input:
            temp_input.write(pdf_bytes)

        # 2. Load PFX cert
        with open(PFX_FILE, 'rb') as f:
            pfx_data = f.read()
        private_key, certificate, _ = pkcs12.load_key_and_certificates(pfx_data, PFX_PASSWORD.encode('utf-8'))

        # 3. Create PEM files temporarily
        cert_pem = certificate.public_bytes(serialization.Encoding.PEM)
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.pem', delete=False) as cert_file:
            cert_file.write(cert_pem)
            cert_file_path = cert_file.name

        with tempfile.NamedTemporaryFile(mode='wb', suffix='.key', delete=False) as key_file:
            key_pem = private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption()
            )
            key_file.write(key_pem)
            key_file_path = key_file.name

        # 4. Load signer
        signer = signers.SimpleSigner.load(
            key_file=key_file_path,
            cert_file=cert_file_path,
        )

        # 5. Prepare input and output files
        output_filename = f"signed_{timestamp}_{file.filename}"
        output_path = os.path.join(UPLOAD_DIR, output_filename)

        with open(temp_input_path, "rb") as inf:
            w = IncrementalPdfFileWriter(inf, strict=False)

            fields.append_signature_field(
                w,
                sig_field_spec=fields.SigFieldSpec("MyCustomSignaturefield", box=(400, 50, 580, 150))
            )

            meta = PdfSignatureMetadata(field_name="MyCustomSignaturefield")
            text_stamp_style = TextStampStyle(
                stamp_text="Signed by: %(signer)s\nDate: %(ts)s",
                text_box_style=TextBoxStyle(
                    font=font_engine,
                    font_size=12,
                    border_width=1,
                ),
                background_opacity=0.5
            )

            pdf_signer = PdfSigner(meta, signer=signer, stamp_style=text_stamp_style)
            with open(output_path, "wb") as outf:
                pdf_signer.sign_pdf(w, output=outf, in_place=False)

        return {"message": "PDF signed successfully", "signed_file_path": output_path}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Signing failed: {str(e)}")

    finally:
        # Clean up
        if os.path.exists(temp_input_path):
            os.remove(temp_input_path)
        if os.path.exists(cert_file_path):
            os.unlink(cert_file_path)
        if os.path.exists(key_file_path):
            os.unlink(key_file_path)
