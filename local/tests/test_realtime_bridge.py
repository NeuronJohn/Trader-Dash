import json
import sys
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from realtime_bridge import LiveBridge, RS, frames, invocation, valid_contract

CONTRACT = "CON.F.US.MES.Z26"
ACCOUNT = 14

def event(name, *args):
    return {"type": 1, "target": name, "arguments": list(args)}

class FakeSocket:
    def __init__(self):
        self.sent = []
        self.values = ["{}" + RS]
        self.lock = threading.Lock()
        self.closed = False
    def settimeout(self, seconds):
        pass
    def send(self, data):
        with self.lock:
            self.sent.append(data)
    def recv(self):
        with self.lock:
            if self.closed:
                return ""
            if self.values:
                return self.values.pop(0)
        raise TimeoutError()
    def close(self):
        self.closed = True

class LiveTests(unittest.TestCase):
    def test_frame_and_method_restrictions(self):
        self.assertEqual(list(frames("{}" + RS + '{"type":6}' + RS)),
                         [{}, {"type": 6}])
        with self.assertRaises(ValueError):
            invocation("PlaceOrder", 1)
        with self.assertRaises(ValueError):
            list(frames('"not object"' + RS))

    def test_wrong_contract_and_stale_quotes(self):
        b = LiveBridge(lambda: "jwt")
        b.selected_account = ACCOUNT
        b.selected_contract = CONTRACT
        now = datetime.now(timezone.utc).isoformat()
        quote = {"lastPrice": 6025.25, "timestamp": now,
                 "bestBid": 6025.0, "bestAsk": 6025.5}
        b._consume("market", event("GatewayQuote", "CON.F.US.NQ.Z26", quote),
                   ACCOUNT, CONTRACT)
        self.assertIsNone(b.snapshot()["quote"])
        b._consume("market", event("GatewayQuote", CONTRACT, quote), ACCOUNT, CONTRACT)
        b._set_connected("market", True)
        self.assertTrue(b.snapshot()["quote_fresh"])
        b._consume("market", event("GatewayQuote", CONTRACT,
                   {"lastPrice": 6025, "timestamp": "2023-01-01T00:00:00Z"}),
                   ACCOUNT, CONTRACT)
        self.assertFalse(b.snapshot()["quote_fresh"])

    def test_selected_account_filters_trade_events(self):
        received = []
        dirty = []
        b = LiveBridge(lambda: "jwt", on_trade=lambda t: received.append(t),
                       on_user_change=lambda: dirty.append(True))
        b.selected_account = ACCOUNT
        b.selected_contract = CONTRACT
        b._consume("user", event("GatewayUserTrade", {"accountId": 99, "id": 1}),
                   ACCOUNT, CONTRACT)
        self.assertEqual(received, [])
        trade = {"id": 2, "accountId": ACCOUNT, "voided": True}
        b._consume("user", event("GatewayUserTrade", trade), ACCOUNT, CONTRACT)
        self.assertEqual(received, [trade])
        self.assertEqual(dirty, [True])

    def test_socket_handshake_and_subscriptions(self):
        sockets = []
        def connect(name, token):
            self.assertEqual(token, "jwt-test")
            s = FakeSocket()
            sockets.append((name, s))
            return s
        b = LiveBridge(lambda: "jwt-test", connector=connect)
        try:
            b.select(ACCOUNT, CONTRACT)
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline and len(sockets) < 2:
                time.sleep(.01)
            self.assertEqual(len(sockets), 2)
            methods = []
            for name, s in sockets:
                with s.lock:
                    methods.extend(json.loads(raw[:-1])["target"]
                                   for raw in s.sent if '"target"' in raw)
            self.assertCountEqual(methods, [
                "SubscribeAccounts", "SubscribeOrders", "SubscribePositions",
                "SubscribeTrades", "SubscribeContractQuotes",
                "SubscribeContractTrades"])
        finally:
            b.close()

    def test_selection_validation(self):
        self.assertTrue(valid_contract(CONTRACT))
        b = LiveBridge(lambda: "jwt")
        with self.assertRaises(ValueError):
            b.select(1, "https://unsafe.test")
        with self.assertRaises(ValueError):
            b.select(0, CONTRACT)

if __name__ == "__main__":
    unittest.main()
