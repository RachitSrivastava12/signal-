
import uuid
import time
import threading
import requests
from collections import defaultdict
from confluent_kafka import Consumer, KafkaError
from solana import dex_block_message_pb2

# ─── CONFIG ─────────────────────────────────────────────────────────────────
KAFKA_BROKERS = "rpk0.bitquery.io:9092,rpk1.bitquery.io:9092,rpk2.bitquery.io:9092"
USERNAME = "solana_138"
PASSWORD = "AOBOI27O7cernP8YW3aaDAICFtetPG"
TOPIC = "solana.dextrades.proto"
NUM_CONSUMERS = 4             # parallel threads = partition coverage
WHALE_THRESHOLD_USD = 10_000
VOLUME_SPIKE_TRADES = 20
VOLUME_SPIKE_USD = 50_000
SOL_REFRESH_SECS = 60         # refresh SOL price every minute

# ─── SHARED STATE (thread-safe via locks) ────────────────────────────────────
lock = threading.Lock()
token_volume   = defaultdict(float)
token_trades   = defaultdict(int)
token_scores   = defaultdict(int)   # alpha score: whale=3, spike=2, new=1
first_seen     = {}                 # token → timestamp (dedup)
fired_whale    = set()              # avoid repeat whale events per token
fired_spike    = set()              # avoid repeat spike events per token

sol_price      = 150.0
sol_price_ts   = 0.0

# ─── SOL PRICE (background refresh) ─────────────────────────────────────────
def refresh_sol_price():
    global sol_price, sol_price_ts
    while True:
        try:
            r = requests.get(
                "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
                timeout=5,
            )
            price = r.json()["solana"]["usd"]
            with lock:
                sol_price = price
                sol_price_ts = time.time()
            print(f"[SOL] ${price:.2f}")
        except Exception as e:
            print(f"[SOL] price fetch error: {e}")
        time.sleep(SOL_REFRESH_SECS)

# ─── EVENT PUSH ──────────────────────────────────────────────────────────────
def send_event(event):
    try:
        requests.post("http://127.0.0.1:8000/event", json=event, timeout=1)
    except Exception:
        pass

# ─── SCORE HELPER ────────────────────────────────────────────────────────────
def compute_score(token):
    score = 0
    if token_trades[token] > VOLUME_SPIKE_TRADES:
        score += 2
    if token_volume[token] > VOLUME_SPIKE_USD:
        score += 2
    if token in first_seen and (time.time() - first_seen[token]) < 300:
        score += 1   # bonus for freshness (<5min old)
    return score

# ─── PROCESS SINGLE TRADE ────────────────────────────────────────────────────
def process_trade(trade):
    global sol_price

    token = trade.Market.BaseCurrency.Symbol
    quote = trade.Market.QuoteCurrency.Symbol

    buy_amount  = trade.Buy.Amount  if trade.HasField("Buy")  else 0
    sell_amount = trade.Sell.Amount if trade.HasField("Sell") else 0

    usd_value = 0.0
    if quote in ("SOL", "WSOL"):
        usd_value = (sell_amount / 1e9) * sol_price
    elif quote in ("USDC", "USDT"):
        usd_value = sell_amount / 1e6

    with lock:
        token_volume[token] += usd_value
        token_trades[token] += 1
        score = compute_score(token)
        token_scores[token] = score

        # NEW TOKEN
        if token not in first_seen:
            first_seen[token] = time.time()
            send_event({
                "type": "new_token",
                "token": token,
                "usd": usd_value,
                "score": score,
                "age_secs": 0,
            })

        # WHALE (fire once per token until it cools down)
        whale_key = f"{token}:{int(time.time() // 60)}"   # 1-min window
        if usd_value > WHALE_THRESHOLD_USD and whale_key not in fired_whale:
            fired_whale.add(whale_key)
            # keep set bounded
            if len(fired_whale) > 2000:
                fired_whale.pop()
            send_event({
                "type": "whale",
                "token": token,
                "usd": usd_value,
                "score": score,
            })

        # VOLUME SPIKE (fire once per token)
        if (
            token_trades[token] > VOLUME_SPIKE_TRADES
            and token_volume[token] > VOLUME_SPIKE_USD
            and token not in fired_spike
        ):
            fired_spike.add(token)
            send_event({
                "type": "volume_spike",
                "token": token,
                "usd": token_volume[token],
                "trades": token_trades[token],
                "score": score,
            })

# ─── SINGLE KAFKA CONSUMER THREAD ────────────────────────────────────────────
def start_consumer(consumer_id: int):
    conf = {
        "bootstrap.servers": KAFKA_BROKERS,
        "group.id": f"{USERNAME}-group-{uuid.uuid4().hex}",
        "session.timeout.ms": 30000,
        "security.protocol": "SASL_PLAINTEXT",
        "sasl.mechanisms": "SCRAM-SHA-512",
        "sasl.username": USERNAME,
        "sasl.password": PASSWORD,
        "auto.offset.reset": "latest",
        # throughput tuning
        "fetch.min.bytes": 1,
        "fetch.wait.max.ms": 100,
        "max.partition.fetch.bytes": 10485760,   # 10MB
    }
    consumer = Consumer(conf)
    consumer.subscribe([TOPIC])
    print(f"[Consumer {consumer_id}] started")

    try:
        while True:
            msg = consumer.poll(1.0)
            if msg is None:
                continue
            if msg.error():
                if msg.error().code() != KafkaError._PARTITION_EOF:
                    print(f"[Consumer {consumer_id}] error: {msg.error()}")
                continue

            try:
                dex_block = dex_block_message_pb2.DexParsedBlockMessage()
                dex_block.ParseFromString(msg.value())
                for tx in dex_block.Transactions:
                    for trade in tx.Trades:
                        process_trade(trade)
            except Exception as e:
                print(f"[Consumer {consumer_id}] parse error: {e}")

    except KeyboardInterrupt:
        pass
    finally:
        consumer.close()
        print(f"[Consumer {consumer_id}] stopped")

# ─── MAIN ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("⚡ Solana Alpha Engine — GOD MODE")
    print(f"   Threads : {NUM_CONSUMERS}")
    print(f"   Topic   : {TOPIC}")
    print(f"   Whale   : ${WHALE_THRESHOLD_USD:,}")

    # SOL price in background
    t_price = threading.Thread(target=refresh_sol_price, daemon=True)
    t_price.start()
    time.sleep(2)   # let price load before consuming

    # parallel Kafka consumers
    threads = []
    for i in range(NUM_CONSUMERS):
        t = threading.Thread(target=start_consumer, args=(i,), daemon=True)
        t.start()
        threads.append(t)

    for t in threads:
        t.join()