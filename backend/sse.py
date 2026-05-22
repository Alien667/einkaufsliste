"""
SSE (Server-Sent Events) registry and broadcast functions.

Each connected client registers an asyncio.Queue per account_id.
When data changes, the broadcast function pushes a message to all
queues for that account.
"""

import asyncio
from typing import Dict, Set
from datetime import datetime

# account_id -> set of asyncio.Queue
REGISTRY: Dict[int, Set[asyncio.Queue]] = {}


def register_client(account_id: int) -> asyncio.Queue:
    """Register a new client and return its event queue."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=50)
    if account_id not in REGISTRY:
        REGISTRY[account_id] = set()
    REGISTRY[account_id].add(queue)
    return queue


def unregister_client(account_id: int, queue: asyncio.Queue):
    """Unregister a client."""
    if account_id in REGISTRY:
        REGISTRY[account_id].discard(queue)
        if not REGISTRY[account_id]:
            del REGISTRY[account_id]


def broadcast(account_id: int, entity: str, entity_id: int, operation: str, data: dict):
    """
    Push a change notification to all connected clients of the given account.

    Args:
        account_id: The account the change belongs to
        entity: One of "areas", "products", "items", "trips"
        entity_id: The ID of the changed entity
        operation: "create", "patch", or "delete"
        data: The full entity data (for creates/patches) or None (for deletes)
    """
    if account_id not in REGISTRY:
        return

    message = {
        "type": "sync_update",
        "entity": entity,
        "entity_id": entity_id,
        "operation": operation,
        "data": data,
        "timestamp": datetime.utcnow().isoformat(),
    }

    dead_queues = set()
    for queue in REGISTRY[account_id]:
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            dead_queues.add(queue)
        except Exception:
            dead_queues.add(queue)

    # Clean up dead queues
    for queue in dead_queues:
        REGISTRY[account_id].discard(queue)


def broadcast_remove(account_id: int, entity: str, entity_id: int):
    """Broadcast a deletion."""
    broadcast(account_id, entity, entity_id, "delete", None)
