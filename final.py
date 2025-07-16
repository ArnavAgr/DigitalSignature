from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import FileResponse
from fastapi.concurrency import run_in_threadpool
import os, json, hashlib
import tempfile
from pyhanko.pdf_utils import layout
from datetime import datetime
from pyhanko.sign import signers, fields, PdfSigner, PdfSignatureMetadata
from pyhanko.stamp import TextStampStyle
from pyhanko.pdf_utils.text import TextBoxStyle
from pyhanko.pdf_utils.font import opentype
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.hazmat.primitives import serialization
import csv
from fastapi import Path
import fitz
import glob
from urllib.parse import unquote
from text_locator import find_keyword_position



app = FastAPI()

# Configuration
UPLOAD_DIR = "uploads"
SESSION_DIR = "sessions"
PFX_FILE = "Test_Doc_Pro.pfx"
PFX_PASSWORD = "Pro123"
FONT_FILE = "C:/Windows/Fonts/calibri.ttf"
APIKEY = "FAKECLIENTKEY1234567890ABCDEF12345678"

#Logging setup
LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, "signing_log.csv")


# Create uploads directory if it doesn't exist
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(SESSION_DIR, exist_ok=True)

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

def process_signing(pdf_bytes: bytes, original_filename: str, department: str, document_type: str, request_id: str):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    temp_input_path = os.path.normpath(os.path.join(UPLOAD_DIR, f"temp_input_{timestamp}.pdf"))
    output_filename = f"signed_{timestamp}_{original_filename}"
    output_path = os.path.normpath(os.path.join(UPLOAD_DIR, output_filename))

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

        if not pdf_bytes.startswith(b"%PDF"):
            raise HTTPException(status_code=400, detail="Invalid PDF file")

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
                stamp_text="Signed by:\n %(signer)s\nDate: %(ts)s",
                text_box_style=TextBoxStyle(
                    font=font_engine if font_engine else None,
                    font_size=12,
                    border_width=1,

                    # Add this box_layout_rule for wrapping and scaling
                    box_layout_rule=layout.SimpleBoxLayoutRule(
                        x_align=layout.AxisAlignment.ALIGN_MIN, # Align text to the left
                        y_align=layout.AxisAlignment.ALIGN_MIN,  # Align text to the top
                        margins=layout.Margins(left=5, right=5, top=5, bottom=5), # Add some padding
                        inner_content_scaling=layout.InnerScaling.SHRINK_TO_FIT # THIS IS KEY for wrapping/shrinking
                    )

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
    

@app.get("/download/{filename}")
async def download_file(filename: str):
    file_path = os.path.normpath(os.path.join(UPLOAD_DIR, filename))
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type='application/pdf'
    )


@app.post("/multi-sign/upload")
async def upload_multi_sign_file(
    myfile: UploadFile = File(...),
    uuid: str = Form(...),
    cs: str = Form(...),
    initiator_workid: str = Form(...),
    initiator_work_dept: str = Form(...),
    workflow_id: str = Form(...),
    signerlist: str = Form(...)
):
    try:
        #Saving uploaded PDF

        expected_cs = hashlib.sha256((APIKEY + uuid).encode("utf-8")).hexdigest()
        if cs != expected_cs:
            raise HTTPException(status_code=403, detail="Invalid checksum or unauthorized request")

        pdf_bytes = await myfile.read()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_name = f"{uuid}_{timestamp}_{myfile.filename}"
        file_path = os.path.join(UPLOAD_DIR, file_name).replace("\\", "/")  # Normalize path

        with open(file_path, "wb") as f:
            f.write(pdf_bytes)

        # Parsing signer list from JSON string
        try:
            signer_list = json.loads(signerlist)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON in signerlist")

        # We validate signer entries and initialize status
        for signer in signer_list:
            required_keys = {"signer_workid", "signer_email", "signer_name", "locations"}
            if not required_keys.issubset(signer.keys()):
                raise HTTPException(
                    status_code=400,
                    detail=f"Each signer must have {required_keys}"
                )
            signer["status"] = "pending"
            signer["signed_at"] = None

        # session data ka creatiion
        session_data = {
            "uuid": uuid,
            "cs": cs,
            "initiator": {
                "workid": initiator_workid,
                "department": initiator_work_dept
            },
            "workflow_id": workflow_id,
            "created_at": timestamp,
            "file_path": os.path.normpath(file_path),
            "signers": signer_list,
            "current_index": 0,
            "completed": False
        }

        # Saving session file
        session_file_path = os.path.join(SESSION_DIR, f"{uuid}.json")
        print(f"Creating session file at: {session_file_path}")  # Debugging log

        with open(session_file_path, "w", encoding="utf-8") as f:
            json.dump(session_data, f, indent=4)

        if not os.path.exists(session_file_path):
            print(f"Session file was not created: {session_file_path}")  # Log missing file
            raise HTTPException(status_code=500, detail="Failed to create session file")

        print(f"Session file created successfully: {session_file_path}")  # Log success

        return {
            "message": "Multi-signer session created successfully",
            "uuid": uuid,
            "next_signer_email": signer_list[0]["signer_email"],
            "download_url": f"/multi-sign/download/{uuid}"
        }

    except Exception as e:
        print(f"Error during session creation: {str(e)}")  # Log error details
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/multi-sign/download/{uuid}")
async def download_signed_pdf(uuid: str):
    session_file_path = os.path.normpath(os.path.join(SESSION_DIR, f"{uuid}.json"))
    
    print(f"Download requested for UUID: {uuid}")
    print(f"Looking for session file: {session_file_path}")
                                     
    if not os.path.exists(session_file_path):
        print(f"Session file not found: {session_file_path}")
        raise HTTPException(status_code=404, detail="Session not found")

    with open(session_file_path, "r", encoding="utf-8") as f:
        session_data = json.load(f)

    signed_file_path = session_data.get("file_path")
    
    print(f"Session file_path: {signed_file_path}")
    
    if not signed_file_path:
        print("No file_path found in session data")
        raise HTTPException(status_code=404, detail="No file path found in session")
    
    if not os.path.exists(signed_file_path):
        print(f"Signed file does not exist: {signed_file_path}")
    
    # List files in upload directory for debugging
        print(f"Files in {UPLOAD_DIR}:")
        if os.path.exists(UPLOAD_DIR):
            for file in os.listdir(UPLOAD_DIR):
                file_path = os.path.normpath(os.path.join(UPLOAD_DIR, file))
                size = os.path.getsize(file_path)
                print(f"  {file} ({size} bytes)")

    # fallback search for latest signed file with UUID in filename
    import glob
    fallback_pattern = os.path.join(UPLOAD_DIR, f"{uuid}_*signed*.pdf")
    candidate_files = sorted(glob.glob(fallback_pattern), reverse=True)
    
    if candidate_files:
        signed_file_path = os.path.normpath(candidate_files[0])
        print(f"Using fallback file: {signed_file_path}")
        
        # Update session data to reflect the corrected path
        session_data["file_path"] = signed_file_path
        with open(session_file_path, "w", encoding="utf-8") as f:
            json.dump(session_data, f, indent=4)
    else:
        raise HTTPException(status_code=404, detail="Signed PDF not found")

    
    # Check file size
    file_size = os.path.getsize(signed_file_path)
    print(f"File size: {file_size} bytes")
    
    if file_size == 0:
        print("ERROR: File is empty!")
        raise HTTPException(status_code=500, detail="File is empty")
    
    myfilename = os.path.basename(signed_file_path)
    print(f"Serving file: {myfilename}")

    return FileResponse(
        path=signed_file_path,
        filename=myfilename,
        media_type='application/pdf'
    )

@app.get("/multi-sign/sign/{uuid}/{signer_email}")
async def sign_document(uuid: str = Path(...), signer_email: str = Path(...)):
    try:
        signer_email = unquote(signer_email)  # Decode URL-encoded email

        # Ensure SESSION_DIR exists
        if not os.path.exists(SESSION_DIR):
            print(f"Session directory does not exist: {SESSION_DIR}")  # Log missing directory
            raise HTTPException(status_code=500, detail="Session directory not found")

        # Debugging log for session file path
        session_file_path = os.path.normpath(os.path.join(SESSION_DIR, f"{uuid}.json"))
        print(f"Looking for session file at: {session_file_path}")

        if not os.path.exists(session_file_path):
            print(f"Session file does not exist: {session_file_path}")  # Log missing file
            raise HTTPException(status_code=404, detail="Session not found")

        with open(session_file_path, "r", encoding="utf-8") as f:
            session_data = json.load(f)

        print(f"Session data loaded successfully: {session_data}")  # Log session data

        if session_data["completed"]:
            return {"message": "Signing already completed for this document."}

        signers_list = session_data["signers"]
        current_index = session_data["current_index"]

        # Step 2: Validate turn
        if signers_list[current_index]["signer_email"] != signer_email:
            raise HTTPException(status_code=403, detail="Not your turn to sign.")

        # Step 3: Load certificate
        with open(PFX_FILE, 'rb') as f:
            pfx_data = f.read()

        private_key, certificate, _ = pkcs12.load_key_and_certificates(
            pfx_data, PFX_PASSWORD.encode('utf-8')
        )

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

        # Step 4: Sign at all coordinates
        signer = signers_list[current_index]
        input_path = session_data["file_path"]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        # output_path = input_path.replace(".pdf", f"_signed_{current_index}.pdf")

        base_path, _ = os.path.splitext(input_path)
        output_path = f"{base_path}_signed_{current_index}.pdf"

        print(f"Input path: {input_path}")
        print(f"Output path: {output_path}")

        with open(input_path, "rb") as inf:
            w = IncrementalPdfFileWriter(inf, strict=False)

            field_names = []

            for idx, loc in enumerate(signer.get("locations", [])):
                keyword = f"Authorised Signature {current_index + 1}"  # dynamic keyword based on signer order
                detected = find_keyword_position(input_path, keyword)

                if detected:
                    print(f"Keyword '{keyword}' found: using auto-detected position")
                    page = detected["page"]
                    x, y = detected["x"], detected["y"]
                else:
                    print(f"Keyword '{keyword}' NOT found: falling back to hardcoded location")
                    page = loc["page"] - 1  # fallback
                    x, y = loc["x"], loc["y"]

                box = (x, y, x + 180, y + 50)
                field_name = f"{signer_email.replace('@','_').replace('.','_')}_sig_{idx}"
                field_names.append(field_name)

                fields.append_signature_field(
                    w,
                    sig_field_spec=fields.SigFieldSpec(field_name, box=box, on_page=page)
                )

            pdf_signer = PdfSigner(
                PdfSignatureMetadata(field_name=field_names[-1],),
                signer=signers.SimpleSigner.load(
                    key_file=key_file_path,
                    cert_file=cert_file_path
                ),
                stamp_style=TextStampStyle(
                    stamp_text=(f"{signer['signer_name']} (%(signer)s)\n"
                        f"{signer['signer_email']}\n"
                        f"%(ts)s"),
                    text_box_style=TextBoxStyle(
                        font=font_engine,
                        font_size=8, 
                        box_layout_rule=layout.SimpleBoxLayoutRule(
                            x_align=layout.AxisAlignment.ALIGN_MIN, # Align text to the left
                            y_align=layout.AxisAlignment.ALIGN_MIN,  # Align text to the top
                            margins=layout.Margins(left=3, right=3, top=3, bottom=3), # Slightly smaller padding
                            inner_content_scaling=layout.InnerScaling.SHRINK_TO_FIT # THIS IS KEY for wrapping/shrinking
                        )
                    )
                )
            )
            
            def blocking_sign_pdf():
                with open(output_path, "wb") as outf:
                    pdf_signer.sign_pdf(w, output=outf)

            await run_in_threadpool(blocking_sign_pdf)

            # with open(output_path, "wb") as outf:
            #     pdf_signer.sign_pdf(w, output=outf)

        # Step 5: Update session
        signer["status"] = "signed"
        signer["signed_at"] = timestamp
        session_data["current_index"] += 1
        session_data["file_path"] = os.path.normpath(output_path)

        if session_data["current_index"] >= len(signers_list):##
            session_data["completed"] = True

        with open(session_file_path, "w", encoding="utf-8") as f:
            json.dump(session_data, f, indent=4)

        # Clean up
        os.unlink(cert_file_path)
        os.unlink(key_file_path)

        return {
            "message": f"Document signed by {signer['signer_name']}",
            "next_signer": (
                signers_list[session_data["current_index"]]["signer_email"] ##
                if not session_data["completed"] else None
            ),
            "download_url": f"/multi-sign/download/{uuid}"
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error during signing: {str(e)}")  # Log error details
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)


# --------------------client_testdata.py--------------------

# config_client_test_data.py

TEST_APIKEY = "FAKECLIENTKEY1234567890ABCDEF12345678"  # Replace with your test key

TEST_UUID = "e317d5f8a6a54e2fb92699491cc75b31"

TEST_SIGNERLIST = [
    {
        "signer_workid": "EMP001",
        "signer_name": "Alice",
        "signer_email": "alice@example.com",
        "locations": [
            {"page": 1, "x": 100, "y": 200},
            {"page": 1, "x": 300, "y": 400}
        ]
    },
    {
        "signer_workid": "EMP002",
        "signer_name": "Bob",
        "signer_email": "bob@example.com",
        "locations": [
            {"page": 2, "x": 150, "y": 250}
        ]
    }
]

TEST_INITIATOR_ID = "HR001"
TEST_INITIATOR_DEPT = "Human Resources"
TEST_WORKFLOW_ID = "invoice"


