import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

@pytest.fixture
def user_data():
    return {
        "email": "test@example.com",
        "password": "testpass",
        "org_id": 1,
        "role": "admin"
    }

def test_signup_and_login(user_data):
    # Signup
    resp = client.post("/auth/signup", json=user_data)
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    assert token
    # Login
    resp = client.post("/auth/login", data={"username": user_data["email"], "password": user_data["password"]})
    assert resp.status_code == 200
    assert "access_token" in resp.json()
