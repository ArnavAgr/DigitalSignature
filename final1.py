<<<<<<< HEAD
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import FileResponse
from fastapi.concurrency import run_in_threadpool
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
import csv
import logging  

app = FastAPI()

# Configuration
UPLOAD_DIR = "uploads"
PFX_FILE = "Test_Doc_Pro.pfx"
PFX_PASSWORD = "Pro123"
FONT_FILE = "C:/Windows/Fonts/calibri.ttf"

#Logging setup
LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, "signing_log.csv")


# Create uploads directory if it doesn't exist
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Check if required files exist
if not os.path.exists(PFX_FILE):
    raise FileNotFoundError(f"Certificate file not found: {PFX_FILE}")

if not os.path.exists(FONT_FILE):
    # Try alternative font paths
    alternative_fonts = [
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/times.ttf",
        "C:/Windows/Fonts/tahoma.ttf"
    ]

    for font_path in alternative_fonts:
        if os.path.exists(font_path):
            FONT_FILE = font_path
            break
    else:
        raise FileNotFoundError(f"No suitable font found. Please check font paths.")

try:
    font_engine = opentype.GlyphAccumulatorFactory(FONT_FILE)
    print(f"Font loaded successfully: {FONT_FILE}")
except Exception as e:
    print(f"Error loading font: {e}")
    font_engine = None

@app.get("/")
async def root():
    return {"message": "PDF Signing API is running"}

@app.post("/sign/file")
async def sign_uploaded_pdf(myfile: UploadFile = File(...), department: str = Form(...), document_type: str = Form(...), request_id: str = Form(...)):
    if not myfile.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    try:
        pdf_bytes = await myfile.read() 
        filename = myfile.filename
        result = await run_in_threadpool(process_signing, pdf_bytes, filename, department, document_type, request_id)
        # run_in_threadpool makes sure that no other process gets blocked while process_signing is executing + it returns a future object that pauses the function on any obstruction and the await keyword assists by not allowing the system to freeze because of the pausing of process_signing and continues serving other functions/API calls until signing_ready is again ready to execute 
        return result
    
    except Exception as e:
        log_signing_event(
            timestamp=datetime.now().strftime("%Y%m%d_%H%M%S"),
            original_file=myfile.filename,
            signed_file="",
            cert_subject="",
            status="failed",
            error_msg=str(e),
            department=department,
            document_type=document_type,
            request_id=request_id, 
        )
        raise HTTPException(status_code=500, detail=f"Signing failed: {str(e)}")

def process_signing(pdf_bytes: bytes, original_filename: str, department: str, document_type: str, request_id: str):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    temp_input_path = os.path.join(UPLOAD_DIR, f"temp_input_{timestamp}.pdf")
    output_filename = f"signed_{timestamp}_{original_filename}"
    output_path = os.path.join(UPLOAD_DIR, output_filename)

    with open(temp_input_path, "wb") as temp_input:
        temp_input.write(pdf_bytes)

    with open(PFX_FILE, 'rb') as f:
        pfx_data = f.read()

    private_key, certificate, _ = pkcs12.load_key_and_certificates(
        pfx_data, PFX_PASSWORD.encode('utf-8')
    )

    cert_subject = certificate.subject.rfc4514_string()


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

    try:
        signer = signers.SimpleSigner.load(
            key_file=key_file_path,
            cert_file=cert_file_path,
        )

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
                    font=font_engine if font_engine else None,
                    font_size=12,
                    border_width=1,
                ),
                background=None,
                background_opacity=0.5
            )

            pdf_signer = PdfSigner(meta, signer=signer, stamp_style=text_stamp_style)

            with open(output_path, "wb") as outf:
                pdf_signer.sign_pdf(w, output=outf, in_place=False)
        
        log_signing_event(
            timestamp=timestamp,
            original_file=original_filename,
            signed_file=output_filename,
            cert_subject=cert_subject,
            status="success"
        )

        return {
            "message": "PDF signed successfully",
            "signed_file_path": output_path,
            "download_url": f"/download/{output_filename}"
        }

    finally:
        if os.path.exists(cert_file_path):
            os.unlink(cert_file_path)
        if os.path.exists(key_file_path):
            os.unlink(key_file_path)
        if os.path.exists(temp_input_path):
            os.remove(temp_input_path)


# function for logging signing events as well as failures 

def log_signing_event(timestamp, original_file, signed_file, cert_subject, status, error_msg="", department="", document_type="", request_id=""):
    fieldnames = ["timestamp", "original_file", "signed_file", "signer_name", "department", "document-type", "request_id", "status", "error"]

    log_exists = os.path.exists(LOG_FILE)

    with open(LOG_FILE, mode="a", newline='', encoding="utf-8") as log_file:
        writer = csv.DictWriter(log_file, fieldnames=fieldnames)
        if not log_exists:
            writer.writeheader()

        writer.writerow({
            "timestamp": timestamp,
            "original_file": original_file,
            "signed_file": signed_file,
            "signer_name": cert_subject,
            "department": department,
            "document-type": document_type,
            "request_id": request_id,
            "status": status,
            "error": error_msg
        })

@app.get("/download/{filename}")
async def download_file(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type='application/pdf'
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
=======
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import FileResponse
from fastapi.concurrency import run_in_threadpool
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
import csv
import logging  

app = FastAPI()

# Configuration
UPLOAD_DIR = "uploads"
PFX_FILE = "Test_Doc_Pro.pfx"
PFX_PASSWORD = "Pro123"
FONT_FILE = "C:/Windows/Fonts/calibri.ttf"

#Logging setup
LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, "signing_log.csv")


# Create uploads directory if it doesn't exist
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Check if required files exist
if not os.path.exists(PFX_FILE):
    raise FileNotFoundError(f"Certificate file not found: {PFX_FILE}")

if not os.path.exists(FONT_FILE):
    # Try alternative font paths
    alternative_fonts = [
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/times.ttf",
        "C:/Windows/Fonts/tahoma.ttf"
    ]

    for font_path in alternative_fonts:
        if os.path.exists(font_path):
            FONT_FILE = font_path
            break
    else:
        raise FileNotFoundError(f"No suitable font found. Please check font paths.")

try:
    font_engine = opentype.GlyphAccumulatorFactory(FONT_FILE)
    print(f"Font loaded successfully: {FONT_FILE}")
except Exception as e:
    print(f"Error loading font: {e}")
    font_engine = None

@app.get("/")
async def root():
    return {"message": "PDF Signing API is running"}

@app.post("/sign/file")
async def sign_uploaded_pdf(myfile: UploadFile = File(...), department: str = Form(...), document_type: str = Form(...), request_id: str = Form(...)):
    if not myfile.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    try:
        pdf_bytes = await myfile.read() 
        filename = myfile.filename
        result = await run_in_threadpool(process_signing, pdf_bytes, filename, department, document_type, request_id)
        # run_in_threadpool makes sure that no other process gets blocked while process_signing is executing + it returns a future object that pauses the function on any obstruction and the await keyword assists by not allowing the system to freeze because of the pausing of process_signing and continues serving other functions/API calls until signing_ready is again ready to execute 
        return result
    
    except Exception as e:
        log_signing_event(
            timestamp=datetime.now().strftime("%Y%m%d_%H%M%S"),
            original_file=myfile.filename,
            signed_file="",
            cert_subject="",
            status="failed",
            error_msg=str(e),
            department=department,
            document_type=document_type,
            request_id=request_id, 
        )
        raise HTTPException(status_code=500, detail=f"Signing failed: {str(e)}")

def process_signing(pdf_bytes: bytes, original_filename: str, department: str, document_type: str, request_id: str):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    temp_input_path = os.path.join(UPLOAD_DIR, f"temp_input_{timestamp}.pdf")
    output_filename = f"signed_{timestamp}_{original_filename}"
    output_path = os.path.join(UPLOAD_DIR, output_filename)

    with open(temp_input_path, "wb") as temp_input:
        temp_input.write(pdf_bytes)

    with open(PFX_FILE, 'rb') as f:
        pfx_data = f.read()

    private_key, certificate, _ = pkcs12.load_key_and_certificates(
        pfx_data, PFX_PASSWORD.encode('utf-8')
    )

    cert_subject = certificate.subject.rfc4514_string()


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

    try:
        signer = signers.SimpleSigner.load(
            key_file=key_file_path,
            cert_file=cert_file_path,
        )

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
                    font=font_engine if font_engine else None,
                    font_size=12,
                    border_width=1,
                ),
                background=None,
                background_opacity=0.5
            )

            pdf_signer = PdfSigner(meta, signer=signer, stamp_style=text_stamp_style)

            with open(output_path, "wb") as outf:
                pdf_signer.sign_pdf(w, output=outf, in_place=False)
        
        log_signing_event(
            timestamp=timestamp,
            original_file=original_filename,
            signed_file=output_filename,
            cert_subject=cert_subject,
            status="success"
        )

        return {
            "message": "PDF signed successfully",
            "signed_file_path": output_path,
            "download_url": f"/download/{output_filename}"
        }

    finally:
        if os.path.exists(cert_file_path):
            os.unlink(cert_file_path)
        if os.path.exists(key_file_path):
            os.unlink(key_file_path)
        if os.path.exists(temp_input_path):
            os.remove(temp_input_path)


# function for logging signing events as well as failures 

def log_signing_event(timestamp, original_file, signed_file, cert_subject, status, error_msg="", department="", document_type="", request_id=""):
    fieldnames = ["timestamp", "original_file", "signed_file", "signer_name", "department", "document-type", "request_id", "status", "error"]

    log_exists = os.path.exists(LOG_FILE)

    with open(LOG_FILE, mode="a", newline='', encoding="utf-8") as log_file:
        writer = csv.DictWriter(log_file, fieldnames=fieldnames)
        if not log_exists:
            writer.writeheader()

        writer.writerow({
            "timestamp": timestamp,
            "original_file": original_file,
            "signed_file": signed_file,
            "signer_name": cert_subject,
            "department": department,
            "document-type": document_type,
            "request_id": request_id,
            "status": status,
            "error": error_msg
        })

@app.get("/download/{filename}")
async def download_file(filename: str):
    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type='application/pdf'
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
>>>>>>> 92be977bfcacbf9d96460763694a87224ff01110
