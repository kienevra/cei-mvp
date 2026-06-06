# backend/app/api/v1/ws.py
from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from starlette.websockets import WebSocketState

from app.core.ws_manager import manager

logger = logging.getLogger("cei")

router = APIRouter(tags=["websocket"])
@router.websocket("/ws/org/{org_id}")
async def org_websocket(
    websocket: WebSocket,
    org_id: int,
    token: str = Query(default=""),
):
    """
    Org-level WebSocket. Receives data_updated events whenever any site
    in this org ingests new data. Used by NotificationBell to update
    in real time without polling.

    Connect: wss://api.carbonefficiencyintel.com/api/v1/ws/org/{org_id}
    """
    key = f"org-{org_id}"
    await manager.connect(websocket, key)
    try:
        while True:
            try:
                data = await websocket.receive_text()
                if data == "pong":
                    continue
            except WebSocketDisconnect:
                break
            except Exception:
                break
    finally:
        manager.disconnect(websocket, key)

@router.websocket("/ws/sites/{site_id}")
async def site_websocket(
    websocket: WebSocket,
    site_id: str,
    token: str = Query(default=""),
):
    """
    WebSocket endpoint: ws(s)://api.carbonefficiencyintel.com/api/v1/ws/sites/{site_id}

    The frontend connects here on SiteView mount and receives a push
    whenever new timeseries data lands for this site — no polling needed.

    Auth note:
    - We accept an optional ?token= query param for future JWT validation.
    - Currently unauthenticated (site data itself is not sent over the socket —
      only a lightweight signal telling the frontend to re-fetch via REST).
    - TODO: validate JWT / integration token before accepting if stricter
      auth is needed.

    Message types sent to client:
      {"event": "ping"}                         — heartbeat every 25s
      {"event": "data_updated", "site_id": ..., "ts": ..., "rows_ingested": ...}
    """
    await manager.connect(websocket, site_id)
    try:
        # Keep the connection alive until the client disconnects.
        # We don't expect messages from the client, but we must await
        # receive to detect disconnects (otherwise disconnect is never raised).
        while True:
            try:
                data = await websocket.receive_text()
                # Handle pong from client (optional — browser WebSocket
                # doesn't send explicit pongs, but custom clients might)
                if data == "pong":
                    continue
            except WebSocketDisconnect:
                break
            except Exception:
                break
    finally:
        manager.disconnect(websocket, site_id)