# backend/app/core/ws_manager.py
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, Set

from fastapi import WebSocket

logger = logging.getLogger("cei")

HEARTBEAT_INTERVAL = 25  # seconds — just under Render's 30s idle timeout


class ConnectionManager:
    """
    Manages active WebSocket connections keyed by site_id.

    Design decisions:
    - One manager instance (singleton via module-level `manager`).
    - Connections are stored per site_id so broadcasts are targeted.
    - Heartbeat task per connection keeps Render's load balancer from
      closing idle sockets.
    - Disconnect is always safe to call even if the connection is already gone.
    """

    def __init__(self) -> None:
        # site_id -> set of active WebSocket connections
        self._connections: Dict[str, Set[WebSocket]] = defaultdict(set)
        # websocket -> heartbeat task
        self._heartbeat_tasks: Dict[WebSocket, asyncio.Task] = {}

    # ── Connect / Disconnect ──────────────────────────────────────────────────

    async def connect(self, websocket: WebSocket, site_id: str) -> None:
        await websocket.accept()
        self._connections[site_id].add(websocket)
        logger.info("ws_connect site_id=%s total_for_site=%d", site_id, len(self._connections[site_id]))

        # Start heartbeat for this connection
        task = asyncio.create_task(self._heartbeat(websocket, site_id))
        self._heartbeat_tasks[websocket] = task

    def disconnect(self, websocket: WebSocket, site_id: str) -> None:
        self._connections[site_id].discard(websocket)
        if not self._connections[site_id]:
            del self._connections[site_id]

        # Cancel heartbeat
        task = self._heartbeat_tasks.pop(websocket, None)
        if task and not task.done():
            task.cancel()

        logger.info("ws_disconnect site_id=%s", site_id)

    # ── Broadcast ─────────────────────────────────────────────────────────────

    async def broadcast(self, site_id: str, event: str, payload: dict) -> None:
        """
        Send a JSON message to all clients watching site_id.
        Silently removes any connections that have gone stale.
        """
        connections = self._connections.get(site_id, set()).copy()
        if not connections:
            return

        message = json.dumps({
            "event": event,
            "site_id": site_id,
            "ts": datetime.now(timezone.utc).isoformat(),
            **payload,
        })

        stale: list[WebSocket] = []
        for ws in connections:
            try:
                await ws.send_text(message)
            except Exception:
                stale.append(ws)

        for ws in stale:
            self.disconnect(ws, site_id)

        if connections:
            logger.info(
                "ws_broadcast site_id=%s event=%s recipients=%d stale_removed=%d",
                site_id, event, len(connections) - len(stale), len(stale),
            )

    # ── Heartbeat ─────────────────────────────────────────────────────────────

    async def _heartbeat(self, websocket: WebSocket, site_id: str) -> None:
        """
        Send a ping every HEARTBEAT_INTERVAL seconds.
        Keeps Render's load balancer from closing the connection.
        If the send fails the connection is gone — disconnect cleanly.
        """
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                try:
                    await websocket.send_text(json.dumps({"event": "ping"}))
                except Exception:
                    break
        except asyncio.CancelledError:
            pass
        finally:
            self.disconnect(websocket, site_id)


# ── Singleton ─────────────────────────────────────────────────────────────────
manager = ConnectionManager()