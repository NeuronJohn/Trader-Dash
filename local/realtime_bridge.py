"""Local-only, read-only ProjectX SignalR user and market subscriptions.

The bearer token never goes to the browser. Transport exceptions are never logged
(they can include the tokenized WebSocket URL). Requires websocket-client.
"""
from __future__ import annotations
import json
import math
import threading
import time
from datetime import datetime, timezone
from urllib.parse import quote

RS = "\x1e"
HUBS = {"user":"wss://rtc.topstepx.com/hubs/user",
        "market":"wss://rtc.topstepx.com/hubs/market"}
SUBSCRIPTIONS = {
    "user": (("SubscribeAccounts", ()), ("SubscribeOrders", ("account",)),
             ("SubscribePositions", ("account",)), ("SubscribeTrades", ("account",))),
    "market": (("SubscribeContractQuotes", ("contract",)),
               ("SubscribeContractTrades", ("contract",))),
}

def frames(payload):
    if not isinstance(payload,str) or len(payload)>1_000_000:
        raise ValueError("Invalid or oversized SignalR frame")
    for fragment in payload.split(RS):
        if fragment:
            item=json.loads(fragment)
            if not isinstance(item,dict):
                raise ValueError("Malformed SignalR JSON")
            yield item

def invocation(target,*args):
    if target not in {name for entries in SUBSCRIPTIONS.values() for name,_ in entries}:
        raise ValueError("Unsupported read-only hub method")
    return json.dumps({"type":1,"target":target,"arguments":list(args)},
                      separators=(",",":")) + RS

def valid_contract(contract):
    return (isinstance(contract,str) and contract.startswith("CON.F.")
            and 8<len(contract)<=90
            and all(ch.isascii() and (ch.isalnum() or ch==".") for ch in contract))

def finite(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)

def timestamp(value):
    if not isinstance(value,str):
        return False
    try:
        return datetime.fromisoformat(value.replace("Z","+00:00")).tzinfo is not None
    except ValueError:
        return False

def is_timeout(exc):
    return isinstance(exc,TimeoutError) or type(exc).__name__=="WebSocketTimeoutException"

class LiveBridge:
    def __init__(self,token_provider,on_trade=None,on_user_change=None,clock=None,connector=None):
        self.token_provider=token_provider
        self.on_trade=on_trade or (lambda trade:None)
        self.on_user_change=on_user_change or (lambda:None)
        self.clock=clock or time.monotonic
        self.connector=connector
        self.lock=threading.RLock()
        self.stop_event=threading.Event()
        self.started=False
        self.selected_account=None
        self.selected_contract=None
        self.version=0
        self.workers=[]
        self.hubs={name:{"connected":False,"last_received":None,"reconnects":0} for name in HUBS}
        self.quote=None
        self.quote_received=None
        self.last_trade=None
        self.account_event=None
        self.orders_event_count=0
        self.positions_event_count=0
        self.user_trade_event_count=0

    def select(self,account_id,contract):
        if type(account_id) is not int or account_id<=0:
            raise ValueError("Select an account first")
        if not valid_contract(contract):
            raise ValueError("Invalid futures contract")
        with self.lock:
            if (account_id,contract)!=(self.selected_account,self.selected_contract):
                self.selected_account,self.selected_contract=account_id,contract
                self.quote=self.quote_received=self.last_trade=self.account_event=None
                self.version+=1
        self.start()

    def start(self):
        with self.lock:
            if self.started:return
            self.started=True
            for name in HUBS:
                t=threading.Thread(target=self._worker,args=(name,),
                                   daemon=True,name="topstep-"+name)
                self.workers.append(t)
                t.start()

    def close(self):
        self.stop_event.set()
        for t in self.workers:t.join(timeout=3)

    def snapshot(self):
        with self.lock:
            now=self.clock()
            hubstates={}
            for name,raw in self.hubs.items():
                age=(max(0,now-raw["last_received"])
                     if raw["last_received"] is not None else None)
                hubstates[name]={"connected":raw["connected"],
                                 "last_event_age_s":round(age,1) if age is not None else None,
                                 "reconnects":raw["reconnects"]}
            qage=max(0,now-self.quote_received) if self.quote_received is not None else None
            broker_age=None
            if self.quote:
                try:
                    dt=datetime.fromisoformat(self.quote["timestamp"].replace("Z","+00:00"))
                    broker_age=max(0,(datetime.now(timezone.utc)-dt).total_seconds())
                except (ValueError,KeyError):pass
            return {"mode":"TOPSTEPX_SIGNALR_READ_ONLY",
                    "selected_account":self.selected_account,
                    "selected_contract":self.selected_contract,
                    "hubs":hubstates,"quote":self.quote,
                    "quote_age_s":round(qage,1) if qage is not None else None,
                    "quote_fresh":bool(hubstates["market"]["connected"] and
                                       qage is not None and qage<=20 and
                                       broker_age is not None and broker_age<=30),
                    "last_market_trade":self.last_trade,
                    "account_update":self.account_event,
                    "orders_event_count":self.orders_event_count,
                    "positions_event_count":self.positions_event_count,
                    "user_trade_event_count":self.user_trade_event_count,
                    "execution":False}

    def _set_connected(self,name,connected):
        with self.lock:
            self.hubs[name]["connected"]=connected
            if connected:self.hubs[name]["last_received"]=self.clock()

    def _consume(self,name,message,subscribed_account,subscribed_contract):
        if message.get("type")!=1:return
        target,args=message.get("target"),message.get("arguments")
        if not isinstance(args,list):return
        if name=="market":
            if len(args)!=2 or args[0]!=subscribed_contract or not isinstance(args[1],dict):
                return
            d=args[1]
            if target=="GatewayQuote":
                if not finite(d.get("lastPrice")) or d["lastPrice"]<=0 or not timestamp(d.get("timestamp")):
                    return
                data={"lastPrice":float(d["lastPrice"]),"timestamp":d["timestamp"]}
                for key in ("bestBid","bestAsk","volume","open","high","low"):
                    if finite(d.get(key)):data[key]=float(d[key])
                with self.lock:
                    if self.selected_contract==subscribed_contract:
                        self.quote=data
                        self.quote_received=self.clock()
            elif target=="GatewayTrade":
                if not finite(d.get("price")) or not timestamp(d.get("timestamp")):
                    return
                with self.lock:
                    if self.selected_contract==subscribed_contract:
                        self.last_trade={"price":float(d["price"]),
                                         "timestamp":d["timestamp"],
                                         "volume":d.get("volume") if finite(d.get("volume")) else None}
        elif name=="user":
            if len(args)!=1 or not isinstance(args[0],dict):return
            d=args[0]
            account=d.get("id") if target=="GatewayUserAccount" else d.get("accountId")
            if account!=subscribed_account:return
            with self.lock:
                if self.selected_account!=subscribed_account:return
                if target=="GatewayUserAccount":
                    self.account_event={"id":account,
                                        "balance":d.get("balance") if finite(d.get("balance")) else None,
                                        "canTrade":d.get("canTrade") if type(d.get("canTrade")) is bool else None}
                elif target=="GatewayUserOrder":self.orders_event_count+=1
                elif target=="GatewayUserPosition":self.positions_event_count+=1
                elif target=="GatewayUserTrade":self.user_trade_event_count+=1
            if target=="GatewayUserTrade":
                try:self.on_trade(d)
                except (ValueError,TypeError,KeyError,OSError):pass
            if target in ("GatewayUserAccount","GatewayUserOrder",
                          "GatewayUserPosition","GatewayUserTrade"):
                self.on_user_change()

    def _connect(self,name,token):
        if self.connector:return self.connector(name,token)
        try:from websocket import create_connection
        except ImportError as exc:
            raise RuntimeError("Missing optional websocket-client package") from exc
        url=HUBS[name]+"?access_token="+quote(token,safe="")
        return create_connection(url,timeout=5,enable_multithread=True)

    def _worker(self,name):
        retries=0
        while not self.stop_event.is_set():
            with self.lock:
                account,contract,v=self.selected_account,self.selected_contract,self.version
            if account is None or (name=="market" and contract is None):
                self.stop_event.wait(.35)
                continue
            ws=None
            try:
                ws=self._connect(name,self.token_provider())
                ws.settimeout(2)
                ws.send('{"protocol":"json","version":1}'+RS)
                handshake=False
                deadline=self.clock()+10
                buffered=[]
                while self.clock()<deadline and not self.stop_event.is_set():
                    try:chunk=ws.recv()
                    except Exception as exc:
                        if is_timeout(exc):continue
                        raise
                    if not isinstance(chunk,str):raise RuntimeError("Invalid socket frame")
                    parts=list(frames(chunk))
                    for index,item in enumerate(parts):
                        if "type" not in item:
                            if item.get("error"):raise RuntimeError("SignalR handshake rejected")
                            handshake=True
                            buffered+=parts[index+1:]
                            break
                    if handshake:break
                if not handshake:raise RuntimeError("SignalR handshake timeout")
                for method,values in SUBSCRIPTIONS[name]:
                    args=[account if x=="account" else contract for x in values]
                    ws.send(invocation(method,*args))
                self._set_connected(name,True)
                retries=0
                last_rx=self.clock()
                last_tx=self.clock()
                for item in buffered:self._consume(name,item,account,contract)
                while not self.stop_event.is_set():
                    with self.lock:
                        if self.version!=v:break
                    if self.clock()-last_rx>50:
                        raise RuntimeError("SignalR heartbeat expired")
                    if self.clock()-last_tx>15:
                        ws.send('{"type":6}'+RS)
                        last_tx=self.clock()
                    try:raw=ws.recv()
                    except Exception as exc:
                        if is_timeout(exc):continue
                        raise
                    if not raw:raise RuntimeError("SignalR disconnected")
                    last_rx=self.clock()
                    with self.lock:self.hubs[name]["last_received"]=last_rx
                    for item in frames(raw):
                        if item.get("type")==7:raise RuntimeError("Server requested reconnect")
                        self._consume(name,item,account,contract)
            except Exception:
                # Do not expose tokenized connection URLs through exceptions.
                retries+=1
                with self.lock:self.hubs[name]["reconnects"]+=1
            finally:
                self._set_connected(name,False)
                if ws:
                    try:ws.close()
                    except Exception:pass
            self.stop_event.wait(min(30,(2**min(5,retries))*.5))
