import requests

API = "https://api.examplepay.invalid/v1"


class PaymentsClient:
    def __init__(self, api_key):
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {api_key}"

    def capture(self, payment_id, amount_cents):
        response = self.session.post(
            f"{API}/payments/{payment_id}/capture",
            json={"amount": amount_cents},
            timeout=10,
        )
        response.raise_for_status()
        return response.json()
