from locust import HttpUser, task, between
import random

UUID = "9f2a3c4d5e6f7b8c9d0e1f2a3b4c5d6e"
SIGNER_EMAIL = "alice@example.com"  # Replace @ with %40 if needed

class SigningUser(HttpUser):
    wait_time = between(1, 2)  # simulate real user pacing

    @task
    def sign_document(self):
        self.client.get(f"/multi-sign/sign/{UUID}/{SIGNER_EMAIL}")
