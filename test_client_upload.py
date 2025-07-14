<<<<<<< HEAD
import requests
import hashlib
import json

API_ENDPOINT = "http://127.0.0.1:8000/multi-sign/upload"


TEST_APIKEY = "FAKECLIENTKEY1234567890ABCDEF12345678"
TEST_UUID = "e317d5f8a6a54e2fb92699491cc75b31"

TEST_SIGNERLIST = [
    {
        "signer_workid": "EMP001",
        "signer_name": "Alice",
        "signer_email": "alice@example.com",
        "locations": [
            {"page": 1, "x": 100, "y": 200}
        ]
    }
]

TEST_INITIATOR_ID = "HR001"
TEST_INITIATOR_DEPT = "Human Resources"
TEST_WORKFLOW_ID = "invoice"

cs = hashlib.sha256((TEST_APIKEY + TEST_UUID).encode("utf-8")).hexdigest()

PDF_FILE_PATH = "emptydoc.pdf"  # Replace with your test PDF

files = {
    "myfile": open(PDF_FILE_PATH, "rb")
}

data = {
    "uuid": TEST_UUID,
    "cs": cs,
    "initiator_workid": TEST_INITIATOR_ID,
    "initiator_work_dept": TEST_INITIATOR_DEPT,
    "workflow_id": TEST_WORKFLOW_ID,
    "signerlist": json.dumps(TEST_SIGNERLIST)
}

response = requests.post(API_ENDPOINT, files=files, data=data)

print("Status Code:", response.status_code)
print("Response JSON:", response.json())
=======
import requests
import hashlib
import json

API_ENDPOINT = "http://127.0.0.1:8000/multi-sign/upload"


TEST_APIKEY = "FAKECLIENTKEY1234567890ABCDEF12345678"
TEST_UUID = "e317d5f8a6a54e2fb92699491cc75b31"

TEST_SIGNERLIST = [
    {
        "signer_workid": "EMP001",
        "signer_name": "Alice",
        "signer_email": "alice@example.com",
        "locations": [
            {"page": 1, "x": 100, "y": 200}
        ]
    }
]

TEST_INITIATOR_ID = "HR001"
TEST_INITIATOR_DEPT = "Human Resources"
TEST_WORKFLOW_ID = "invoice"

cs = hashlib.sha256((TEST_APIKEY + TEST_UUID).encode("utf-8")).hexdigest()

PDF_FILE_PATH = "emptydoc.pdf"  # Replace with your test PDF

files = {
    "myfile": open(PDF_FILE_PATH, "rb")
}

data = {
    "uuid": TEST_UUID,
    "cs": cs,
    "initiator_workid": TEST_INITIATOR_ID,
    "initiator_work_dept": TEST_INITIATOR_DEPT,
    "workflow_id": TEST_WORKFLOW_ID,
    "signerlist": json.dumps(TEST_SIGNERLIST)
}

response = requests.post(API_ENDPOINT, files=files, data=data)

print("Status Code:", response.status_code)
print("Response JSON:", response.json())
>>>>>>> 92be977bfcacbf9d96460763694a87224ff01110
