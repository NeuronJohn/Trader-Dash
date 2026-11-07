"""Hermetic, no-credential HTTP smoke test of the actual Topstep workstation.

Starts the same server entrypoint as Windows demo mode on loopback, using an
ephemeral port and private SQLite directory; never contacts ProjectX or needs API.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
SERVER=ROOT/"local"/"topstep_server.py"


class DemoHttpSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1",0))
            cls.port=sock.getsockname()[1]
        cls.url=f"http://127.0.0.1:{cls.port}"
        env=dict(os.environ)
        env.update({"TRADER_DEMO":"1","TRADER_PORT":str(cls.port),
                    "TRADER_DATA_DIR":cls.tmp.name})
        env.pop("TOPSTEPX_USERNAME",None)
        env.pop("TOPSTEPX_API_KEY",None)
        cls.proc=subprocess.Popen(
            [sys.executable,str(SERVER),"--no-browser"],
            cwd=str(ROOT),env=env,stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE)
        cls.token=""
        deadline=time.monotonic()+12
        while time.monotonic()<deadline:
            if cls.proc.poll() is not None:
                raise RuntimeError("Offline demo server exited unexpectedly")
            try:
                with urllib.request.urlopen(cls.url+"/api/session",timeout=.5) as r:
                    data=json.load(r)
                    cls.token=data["token"]
                    break
            except (OSError,ValueError):
                time.sleep(.1)
        if not cls.token:
            cls.proc.terminate()
            raise RuntimeError("Offline demo did not expose local session")

    @classmethod
    def tearDownClass(cls):
        try:
            cls.proc.terminate()
            cls.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.proc.kill()
            cls.proc.wait()
        finally:
            if cls.proc.stderr:cls.proc.stderr.close()
            cls.tmp.cleanup()

    def api(self,path,token=True,method="GET",payload=None,origin=None):
        headers={"X-Trader-Token":self.token if token else "invalid"}
        raw=None
        if payload is not None:
            raw=json.dumps(payload).encode()
            headers["Content-Type"]="application/json"
        if origin is not None:headers["Origin"]=origin
        req=urllib.request.Request(self.url+path,headers=headers,
                                   data=raw,method=method)
        with urllib.request.urlopen(req,timeout=7) as response:
            return json.load(response)

    def test_health_synthetic_and_no_broker_credentials(self):
        data=self.api("/topstep/api/health")
        self.assertTrue(data["synthetic"])
        self.assertTrue(data["configured"])
        self.assertFalse(data["execution"])

    def test_accounts_and_analytics_are_synthetic(self):
        accounts=self.api("/topstep/api/accounts")
        self.assertTrue(accounts["synthetic"])
        self.assertEqual(len(accounts["accounts"]),1)
        a=accounts["accounts"][0]
        self.assertFalse(a["canTrade"])
        data=self.api(f"/topstep/api/account?id={a['id']}&days=30")
        self.assertTrue(data["synthetic"])
        self.assertEqual(data["source"],"SYNTHETIC_OFFLINE_FIXTURE")
        self.assertEqual(data["stats"]["source"],"SYNTHETIC_OFFLINE_FIXTURE")
        self.assertEqual(data["completed_trades"]["source"],"SYNTHETIC_OFFLINE_FIXTURE")
        self.assertGreater(data["stats"]["active_legs"],0)
        self.assertGreater(data["completed_trades"]["complete_trade_count"],0)
        self.assertFalse(data["order_execution_enabled"])
        self.assertGreater(data["stats"]["voided_legs"],0)

    def test_candles_and_structure_without_network(self):
        found=self.api("/topstep/api/contracts?symbol=MES")
        ids=[x["id"] for x in found["contracts"]]
        self.assertIn("CON.F.US.MES.Z26",ids)
        query="/topstep/api/bars?contract=CON.F.US.MES.Z26&minutes=5"
        data=self.api(query)
        self.assertTrue(data["synthetic"])
        self.assertGreater(len(data["bars"]),100)
        self.assertEqual(data["context"]["source"],"SYNTHETIC_OFFLINE_FIXTURE")
        self.assertTrue(data["context"]["not_a_trade_signal"])

    def test_demo_live_subscription_never_connects_to_broker(self):
        a=self.api("/topstep/api/accounts")["accounts"][0]["id"]
        payload={"account_id":a,"contract_id":"CON.F.US.MES.Z26"}
        ok=self.api("/topstep/api/live/subscribe",method="POST",payload=payload,
                    origin=self.url)
        self.assertTrue(ok["subscribed"])
        self.assertFalse(ok["execution"])
        live=self.api("/topstep/api/live")
        self.assertTrue(live["synthetic"])
        self.assertEqual(live["mode"],"DEMO_SYNTHETIC_NO_NETWORK")
        self.assertTrue(live["quote_fresh"])

    def test_risk_and_chart_modules_use_same_origin(self):
        for path, marker in (
            ("/topstep/risk-plan.js", b"TraderRisk"),
            ("/topstep/chart-model.js", b"TraderChart"),
        ):
            with urllib.request.urlopen(self.url+path,timeout=5) as response:
                content=response.read(20000)
                self.assertEqual(response.status,200)
                self.assertIn("javascript",response.headers["Content-Type"])
                self.assertIn(marker,content)

    def test_no_order_endpoint_even_in_demo(self):
        payload={"accountId":9900001,"type":2,"side":0,"size":1}
        req=urllib.request.Request(
            self.url+"/topstep/api/Order/place",
            headers={"X-Trader-Token":self.token,"Origin":self.url,
                     "Content-Type":"application/json"},
            data=json.dumps(payload).encode(),method="POST")
        with self.assertRaises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(req,timeout=5)
        self.assertEqual(exc.exception.code,405)

    def test_session_auth_and_origin_controls(self):
        with self.assertRaises(urllib.error.HTTPError) as exc:
            self.api("/topstep/api/accounts",token=False)
        self.assertEqual(exc.exception.code,403)
        a=self.api("/topstep/api/accounts")["accounts"][0]["id"]
        with self.assertRaises(urllib.error.HTTPError) as exc:
            self.api("/topstep/api/live/subscribe",method="POST",
                     origin="https://untrusted.example",
                     payload={"account_id":a,"contract_id":"CON.F.US.MES.Z26"})
        self.assertEqual(exc.exception.code,403)

    def test_separate_demo_database(self):
        self.api("/topstep/api/account?id=9900001&days=30")
        fixture=Path(self.tmp.name)/"demo-fixture-ledger.sqlite3"
        real=Path(self.tmp.name)/"topstep-ledger.sqlite3"
        self.assertTrue(fixture.exists())
        self.assertFalse(real.exists())

if __name__=="__main__":unittest.main()
