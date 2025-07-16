
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
