import requests
import time
import os
import json
import csv
import uuid
import hashlib

# === CONFIGURATION ===
API_BASE = "http://localhost:8000"
UPLOAD_ENDPOINT = f"{API_BASE}/multi-sign/upload"
SIGN_ENDPOINT = f"{API_BASE}/multi-sign/sign"
PDF_DIR = "Testing/Load_testing"  # Folder containing the test PDFs
RESULT_CSV = "multi_sign_results.csv"

# 🔐 API Key and fixed signer details
APIKEY = "FAKECLIENTKEY1234567890ABCDEF12345678"
SIGNER_EMAIL = "test@example.com"
SIGNER_NAME = "TestUser"
SIGNER_WORKID = "EMP001"
INITIATOR_ID = "HR001"
INITIATOR_DEPT = "IT"
WORKFLOW_ID = "loadtest"

# === List of Test Files ===
test_files = [
    ("test_1p.pdf", 1),
    ("test_10p.pdf", 10),
    ("test_100p.pdf", 100),
    ("test_500p.pdf", 500),
    ("test_1000p.pdf", 1000),
]

def generate_cs(uuid_str):
    return hashlib.sha256((APIKEY + uuid_str).encode("utf-8")).hexdigest()

results = []

for filename, page_count in test_files:
    file_path = os.path.join(PDF_DIR, filename)
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        continue

    uuid_str = str(uuid.uuid4())
    cs = generate_cs(uuid_str)

    # One signer, one signature location per page
    locations = [{"page": i + 1, "x": 100, "y": 200} for i in range(page_count)]
    signer_list = [
        {
            "signer_workid": SIGNER_WORKID,
            "signer_name": SIGNER_NAME,
            "signer_email": SIGNER_EMAIL,
            "locations": locations
        }
    ]

    with open(file_path, "rb") as f:
        files = {"myfile": (filename, f, "application/pdf")}
        data = {
            "uuid": uuid_str,
            "cs": cs,
            "initiator_workid": INITIATOR_ID,
            "initiator_work_dept": INITIATOR_DEPT,
            "workflow_id": WORKFLOW_ID,
            "signerlist": json.dumps(signer_list)
        }

        print(f" Uploading {filename} with {page_count} signature fields...")
        r = requests.post(UPLOAD_ENDPOINT, files=files, data=data)
        if r.status_code != 200:
            print(f" Upload failed ({r.status_code}): {r.text}")
            continue

    sign_url = f"{SIGN_ENDPOINT}/{uuid_str}/{SIGNER_EMAIL}"
    print(f" Signing {page_count} pages...")
    start_time = time.time()
    r = requests.get(sign_url)
    end_time = time.time()
    duration = round(end_time - start_time, 2)

    if r.status_code == 200:
        print(f" Success: Signed {page_count} pages in {duration}s")
        results.append({
            "filename": filename,
            "pages": page_count,
            "time_taken_sec": duration,
            "success": True
        })
    else:
        print(f" Signing failed: {r.status_code} - {r.text}")
        results.append({
            "filename": filename,
            "pages": page_count,
            "time_taken_sec": duration,
            "success": False
        })

# Save results
with open(RESULT_CSV, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["filename", "pages", "time_taken_sec", "success"])
    writer.writeheader()
    writer.writerows(results)

print(f" Results saved to {RESULT_CSV}")
