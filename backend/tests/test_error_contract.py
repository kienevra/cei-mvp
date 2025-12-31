# backend/tests/test_error_contract.py

from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

# Import the real exception handlers (do NOT rely on FastAPI defaults)
from app.main import http_exception_handler, validation_exception_handler


def test_http_exception_detail_dict_is_preserved_and_merged():
    app = FastAPI()

    # Install the real handlers from app.main
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)

    r = APIRouter()

    @r.get("/boom")
    def boom():
        raise HTTPException(
            status_code=400,
            detail={"type": "schema_error", "missing": ["timestamp_utc"], "message": "Bad schema"},
        )

    app.include_router(r, prefix="/api/v1")

    client = TestClient(app)
    resp = client.get("/api/v1/boom")
    assert resp.status_code == 400

    body = resp.json()
    assert body["code"] == "HTTP_400"
    assert body["detail"]["code"] == "HTTP_400"

    # ✅ Structured detail dict is preserved
    assert body["detail"].get("type") == "schema_error"
    assert body["detail"].get("missing") == ["timestamp_utc"]
    assert body["detail"].get("message") == "Bad schema"

    # ✅ request_id is always present in the top-level contract
    assert "request_id" in body
    assert isinstance(body["request_id"], str)
    assert len(body["request_id"]) > 0
