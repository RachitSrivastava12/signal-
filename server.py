import json
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from collections import deque

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── TOKEN STORE ─────────────────────────────────────────────────────────────
MAX_PRICE_HISTORY = 60
token_store: dict = {}

def upsert_token(event: dict):
    token = event.get("token")
    if not token:
        return
    if token not in token_store:
        token_store[token] = {
            "token":      token,
            "type":       event.get("type"),
            "first_seen": time.time(),
            "last_seen":  time.time(),
            "score":      event.get("score", 0),
            "prices":     deque(maxlen=MAX_PRICE_HISTORY),
            "signals":    [],
        }
    entry = token_store[token]
    entry["last_seen"] = time.time()
    entry["score"]     = max(entry["score"], event.get("score", 0))

    usd = event.get("usd", 0)
    if usd and usd > 0:
        entry["prices"].append({"ts": time.time(), "usd": usd})

    entry["signals"].append(event.get("type"))
    if len(entry["signals"]) > 20:
        entry["signals"] = entry["signals"][-20:]


# ─── CONNECTION MANAGER ──────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        payload = json.dumps(data)
        for ws in self.active:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

manager = ConnectionManager()

# ─── THROTTLE ────────────────────────────────────────────────────────────────
RATE_LIMITS = {"new_token": 5, "whale": 10, "volume_spike": 3}
_type_windows: dict = {k: deque() for k in RATE_LIMITS}

def is_throttled(event_type: str) -> bool:
    if event_type not in RATE_LIMITS:
        return False
    window = _type_windows[event_type]
    limit  = RATE_LIMITS[event_type]
    now    = time.time()
    while window and window[0] < now - 1.0:
        window.popleft()
    if len(window) >= limit:
        return True
    window.append(now)
    return False


# ─── ROUTES ──────────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    print(f"Client connected  (total={len(manager.active)})")
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, Exception):
        manager.disconnect(websocket)

@app.post("/event")
async def push_event(data: dict):
    event_type = data.get("type", "unknown")
    upsert_token(data)                          # always store, even if throttled
    if is_throttled(event_type):
        return {"status": "throttled"}
    data["ts"] = time.time()
    await manager.broadcast(data)
    return {"status": "sent", "clients": len(manager.active)}

@app.get("/token/{symbol}")
async def get_token(symbol: str):
    entry = token_store.get(symbol)
    if not entry:
        raise HTTPException(status_code=404, detail="Token not found")
    prices = list(entry["prices"])
    return {
        "token":       entry["token"],
        "type":        entry["type"],
        "score":       entry["score"],
        "first_seen":  entry["first_seen"],
        "last_seen":   entry["last_seen"],
        "signals":     entry["signals"],
        "prices":      prices,
        "price_now":   prices[-1]["usd"] if prices else 0,
        "price_open":  prices[0]["usd"]  if prices else 0,
        "price_high":  max(p["usd"] for p in prices) if prices else 0,
        "price_low":   min(p["usd"] for p in prices) if prices else 0,
    }

@app.get("/health")
async def health():
    return {"clients": len(manager.active), "tokens_tracked": len(token_store), "status": "ok"}