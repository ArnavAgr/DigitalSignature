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
PDF_PATH = "Testing/Workflow_Scaling/test_10p.pdf"  # A 5-page test PDF
RESULT_CSV = "workflow_scaling_results.csv"

# 🔐 Set your API key (used to compute `cs`)
APIKEY = "FAKECLIENTKEY1234567890ABCDEF12345678"  # Replace with real API key
INITIATOR_ID = "HR001"
INITIATOR_DEPT = "IT"
WORKFLOW_ID = "workflowtest"

# === Test Scenarios ===
# Format: (scenario_label, num_signers, sigs_per_signer)
test_scenarios = [
    ("A", 2, 1),
    ("B", 5, 2),
    ("C", 10, 3)
]

# === Helper to generate checksum ===
def generate_cs(uuid_str):
    return hashlib.sha256((APIKEY + uuid_str).encode("utf-8")).hexdigest()

# === Helper to generate signerlist ===
def generate_signerlist(num_signers, sigs_per_signer):
    signer_list = []
    for i in range(num_signers):
        signer_email = f"signer{i}@example.com"
        locations = []
        for j in range(sigs_per_signer):
            locations.append({"page": (j % 5) + 1, "x": 100 + j*10, "y": 200 + j*10})
        signer = {
            "signer_workid": f"EMP{i:03d}",
            "signer_name": f"Signer {i}",
            "signer_email": signer_email,
            "locations": locations
        }
        signer_list.append(signer)
    return signer_list

# === Begin test run ===
results = []

for label, num_signers, sigs_per_signer in test_scenarios:
    if not os.path.exists(PDF_PATH):
        print(f"File not found: {PDF_PATH}")
        break

    uuid_str = str(uuid.uuid4())
    cs = generate_cs(uuid_str)
    signer_list = generate_signerlist(num_signers, sigs_per_signer)

    # === Upload PDF ===
    with open(PDF_PATH, "rb") as f:
        files = {"myfile": (os.path.basename(PDF_PATH), f, "application/pdf")}
        data = {
            "uuid": uuid_str,
            "cs": cs,
            "initiator_workid": INITIATOR_ID,
            "initiator_work_dept": INITIATOR_DEPT,
            "workflow_id": WORKFLOW_ID,
            "signerlist": json.dumps(signer_list)
        }

        print(f"\nUploading scenario {label}: {num_signers} signers x {sigs_per_signer} sigs...")
        r = requests.post(UPLOAD_ENDPOINT, files=files, data=data)
        if r.status_code != 200:
            print(f"Upload failed: {r.status_code} - {r.text}")
            continue

    # === Signers take turns ===
    all_success = True
    total_time = 0

    for signer in signer_list:
        signer_email = signer["signer_email"]
        sign_url = f"{SIGN_ENDPOINT}/{uuid_str}/{signer_email}"
        start = time.time()
        r = requests.get(sign_url)
        elapsed = round(time.time() - start, 2)
        total_time += elapsed

        if r.status_code == 200:
            print(f"  Signed by {signer_email} in {elapsed}s")
        else:
            print(f" Failed for {signer_email}: {r.status_code} - {r.text}")
            all_success = False
            break

    results.append({
        "scenario": label,
        "signers": num_signers,
        "sigs_per_signer": sigs_per_signer,
        "total_signatures": num_signers * sigs_per_signer,
        "time_taken_sec": total_time,
        "success": all_success
    })

# === Save Results ===
with open(RESULT_CSV, "w", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["scenario", "signers", "sigs_per_signer", "total_signatures", "time_taken_sec", "success"])
    writer.writeheader()
    for row in results:
        writer.writerow(row)

print(f"Workflow scaling results saved to {RESULT_CSV}")
