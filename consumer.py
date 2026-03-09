import uuid
from confluent_kafka import Consumer
from solana import dex_block_message_pb2

conf = {
"bootstrap.servers": "rpk0.bitquery.io:9092,rpk1.bitquery.io:9092,rpk2.bitquery.io:9092",
"group.id": f"solana_138-group-{uuid.uuid4().hex}",
"session.timeout.ms": 30000,
"security.protocol": "SASL_PLAINTEXT",
"sasl.mechanisms": "SCRAM-SHA-512",
"sasl.username": "solana_138",
"sasl.password": "AOBOI27O7cernP8YW3aaDAICFtetPG",
"auto.offset.reset": "latest",
}

consumer = Consumer(conf)

consumer.subscribe(["solana.dextrades.proto"])

print("Listening for Solana DEX trades...")

while True:
    msg = consumer.poll(1.0)

    if msg is None:
        continue

    if msg.error():
        print("Error:", msg.error())
        continue

    buffer = msg.value()

    dex_block = dex_block_message_pb2.DexParsedBlockMessage()
    dex_block.ParseFromString(buffer)

    print("\nNew DEX block received\n")
    print(dex_block)
