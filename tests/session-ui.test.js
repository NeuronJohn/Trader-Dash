import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {fileURLToPath} from "node:url";
import "../prototype/session-engine.js";
import "../prototype/paper-ledger.js";

const html=readFileSync(join(dirname(fileURLToPath(import.meta.url)),"../prototype/trader-workspace.html"),"utf8");
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const paints="clearRect fillRect setTransform save restore beginPath rect clip moveTo lineTo stroke fill fillText setLineDash strokeRect arc closePath".split(" ");
const ctx=Object.fromEntries(paints.map(name=>[name,()=>{}]));
function fixture(day){
  const start=Date.parse(day+"T13:30:00Z");
  const make=(i,o=6000,h=6000.25,l=5999.75,c=6000)=>({
    time:start+i*300000,open:o,high:h,low:l,close:c});
  const a=Array.from({length:30},(_,i)=>make(i));
  a[0]=make(0,6000,6010,5990,6000);
  a[1]=make(1,6000,6009,5991,6000);
  a[2]=make(2,6000,6009,5991,6000);
  a[3]=make(3,6009,6012,6008,6011);
  a[4]=make(4,6011,6012,6010,6011);
  a[5]=make(5,6011,6013.5,6010.5,6013);
  a[6]=make(6,6013,6014,6012,6013.5);
  a[7]=make(7,6014,6022,6013,6021);
  return a;
}
function createUI(fetchImpl){
  class Node{
    constructor(id){
      this.id=id;
      this.value=id==="scanFilter"||id==="simKind"?"all":
        id==="mesRule"?"ORP-001":id==="mesSlip"?"1":id==="mesFee"?"2.5":
        id==="mesReward"?"2":id==="simSlip"||id==="simFee"?"1":
        id==="simTarget"?"2":id==="simHold"?"12":"";
      this.checked=false;this.disabled=false;this.clientWidth=1050;this.clientHeight=500;
      this.children=[];this.dataset={};this.style={};this.listeners={};
      this.classList={add(){},remove(){},toggle(){}};
    }
    set textContent(value){
      this._textContent=String(value);
      if(value==="")this.children=[];
    }
    get textContent(){return this._textContent||""}
    addEventListener(type,callback){(this.listeners[type]??=[]).push(callback)}
    append(...items){this.children.push(...items)}
    appendChild(item){this.children.push(item);return item}
    setAttribute(){}
    remove(){}
    scrollIntoView(){}
    getBoundingClientRect(){return {left:0,top:0,width:1050,height:500}}
    setPointerCapture(){}
    releasePointerCapture(){}
    getContext(){return ctx}
  }
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]);
  const nodes=Object.fromEntries(ids.map(id=>[id,new Node(id)]));
  const groups=Object.fromEntries(["tool","view","strategy","prompt","scope","ai-mode"].map(type=>
    [type,[...html.matchAll(new RegExp('data-'+type+'="([^"]+)"','g'))].map(x=>{
      const e=new Node(x[1]);e.dataset[type.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=x[1];return e;
    })]));
  const document={
    getElementById:id=>nodes[id],createElement:tag=>new Node(tag),
    querySelectorAll:selector=>groups[selector.match(/\[data-([a-z-]+)\]/)?.[1]]||[],
    documentElement:new Node("html"),body:new Node("body"),addEventListener(){}
  };
  const window={matchMedia(){return {matches:false}},addEventListener(){},confirm(){return true}};
  const inner=script.slice(script.indexOf("(function(){")+"(function(){".length,script.lastIndexOf("})();"));
  const patched=inner.replace(/\n\s*start\(\);\s*$/,
    '\nreturn start().then(()=>({S,resetDataset,runMesResearch,runMesScan,focusMesSignal,focusMesCase,visible,packet,capturePaperCase,reconcilePaperCases,renderPaperLedger,checkMarketStatus,fetchPracticeCandles,loadPracticeCandles}));');
  assert.notEqual(inner,patched);
  const launch=new Function("document","window","globalThis","indexedDB","localStorage","devicePixelRatio",
    "requestAnimationFrame","ResizeObserver","setTimeout","clearTimeout","fetch",patched);
  return launch(document,window,globalThis,undefined,
    {getItem(){return null},setItem(){}},1,fn=>fn(),class {observe(){}},()=>1,()=>{},
    fetchImpl|| (async()=>{throw Error("Optional model is intentionally unavailable")})).then(r=>({...r,nodes}));
}
function dataset(){
  const dates=[];
  for(let i=1;i<=20;i++){
    const d="2026-07-"+String(i).padStart(2,"0");
    if([0,6].includes(new Date(d+"T12:00:00Z").getUTCDay()))continue;
    dates.push(d);
  }
  return {id:"csv-test-mes-v4",symbol:"MES_5m_July",source:"user-csv-unverified",
    timeframe:"5m",label:"Unverified fixture",bars:dates.flatMap(fixture)};
}
test("a confirmed MES import can run exact strategy and preserve hidden reserve",async()=>{
  const x=await createUI();
  x.resetDataset(dataset());
  x.nodes.mesConfirm.checked=true;
  await x.runMesResearch();
  assert.ok(x.S.mesRun?.report?.allTrades.length>0);
  assert.equal(x.S.mesRun.report.rule,"ORP-001");
  assert.equal(x.S.mesRun.holdoutRevealedAt,null);
  const stored=x.S.experimentRuns[0];
  assert.equal(stored.kind,"MES_SESSION_V1");
  assert.equal(stored.report.reserve,null);
  assert.deepEqual(stored.report.reserveTrades,[]);
  assert.ok(stored.report.allTrades.every(t=>t.day<=stored.report.split.trainingThrough));
});
test("scanner opens historical case at confirmation without exposing next candle",async()=>{
  const x=await createUI();
  x.resetDataset(dataset());
  x.nodes.mesConfirm.checked=true;
  x.runMesScan();
  assert.ok(x.S.mesSignals.matches.length>0);
  const signal=x.S.mesSignals.matches[0];
  x.focusMesSignal(signal);
  assert.equal(x.S.replay,true);
  assert.equal(x.nodes.replayToggle.checked,true);
  assert.equal(x.visible().bars.at(-1).time,signal.signalBarStart);
  assert.equal(x.S.mesSignalPreview.status,"HISTORICAL_RESEARCH_MATCH_NOT_A_TRADE");
  assert.equal(x.S.mesPreview,null);
});
test("MES research is blocked until source is explicitly acknowledged",async()=>{
  const x=await createUI();
  x.resetDataset(dataset());
  await x.runMesResearch();
  assert.equal(x.S.mesRun,null);
  assert.equal(x.S.experimentRuns.length,0);
  assert.ok(x.nodes.mesResult.children.length>0);
});

function fakePaperDb(){
  const saved=new Map();
  return {
    saved,
    transaction(){
      const tx={oncomplete:null,onerror:null,
        objectStore:()=>({
          put(c){
            saved.set(c.id,JSON.parse(JSON.stringify(c)));
            Promise.resolve().then(()=>tx.oncomplete?.());
            return {result:c};
          }
        })
      };
      return tx;
    }
  };
}
test("paper case can be recorded from MES discovery and stored before its outcome",async()=>{
  const x=await createUI();
  x.resetDataset(dataset());x.nodes.mesConfirm.checked=true;
  x.runMesScan();
  x.S.db=fakePaperDb();
  await x.capturePaperCase(false);
  assert.equal(x.S.paperCases.length,1);
  assert.equal(x.S.paperCases[0].status,"PENDING");
  assert.equal(x.S.paperCases[0].origin,"HISTORICAL_REPLAY");
  assert.equal(x.S.paperCases[0].outcome,undefined);
  assert.equal(x.S.db.saved.size,1);
  assert.equal(x.nodes.paperCases.children.length,1);
});
test("outcome reconciliation adds a later event without changing the captured signal",async()=>{
  const x=await createUI();x.resetDataset(dataset());x.nodes.mesConfirm.checked=true;
  x.runMesScan();x.S.db=fakePaperDb();
  await x.capturePaperCase(false);
  const prefix=JSON.stringify(x.S.paperCases[0].prefix);
  await x.reconcilePaperCases();
  assert.equal(x.S.paperCases.length,1);
  assert.equal(x.S.paperCases[0].status,"RESOLVED");
  assert.equal(x.S.paperCases[0].events.length,2);
  assert.equal(JSON.stringify(x.S.paperCases[0].prefix),prefix);
  assert.ok(Number.isFinite(x.S.paperCases[0].outcome.netR));
  assert.equal(x.nodes.paperSummary.children.length,3);
});
test("paper statistics are opt-in and excluded from historical replay AI context",async()=>{
  const x=await createUI();x.resetDataset(dataset());x.nodes.mesConfirm.checked=true;
  x.runMesScan();x.S.db=fakePaperDb();await x.capturePaperCase(false);
  x.nodes.aiPrompt.value="Explain this MES setup";
  assert.equal(x.packet().evidence.paper_research,undefined);
  x.S.scopes.paper=true;
  assert.equal(x.packet().evidence.paper_research.summary.verifiedForwardCases,0);
  x.S.replay=true;x.S.reveal=10;x.S.viewportEnd=10;
  assert.equal(x.packet().evidence.paper_research,undefined);
});

test("OANDA practice controls load provider receipts without leaking tokens or enabling MES rule tests",async()=>{
  const observed=[];
  const marketBar=(i)=>{
    const time=Date.parse("2026-11-05T14:00:00.000Z")+i*300000;
    return {time,open:1.1,high:1.1006,low:1.0998,close:1.1003,
      bidClose:1.10025,askClose:1.10035,
      receivedAt:Date.parse("2026-11-05T20:00:00Z"),receiptId:"source-receipt-123"};
  };
  const answer=(body)=>({ok:true,json:async()=>body});
  const fetchImpl=async (url,options={})=>{
    observed.push({url,method:options.method||"GET",headers:options.headers,body:options.body});
    if(url==="/api/session")return answer({ok:true,token:"local-session-token",
      ollama:{reachable:false,model_available:false,model:"none"}});
    if(url==="/api/market/status")return answer({ok:true,market:{provider:"OANDA practice only",
      configured:true,stored_candle_counts:{EUR_USD:2}}});
    if(url==="/api/market/fetch")return answer({ok:true,market_receipt:{
      symbol:"EUR_USD",source:"oanda-fxpractice",receipt_id:"source-receipt-123",
      added:2,repeated:0,conflicts:0
    }});
    if(url==="/api/market/candles?symbol=EUR_USD&limit=1000")
      return answer({ok:true,market:{
        symbol:"EUR_USD",source:"oanda-fxpractice",granularity:"M5",
        bars:[marketBar(0),marketBar(1)],last_received_utc_ms:Date.parse("2026-11-05T20:00:00Z"),
        conflicts:0
      }});
    throw Error("Unexpected API path "+url);
  };
  const x=await createUI(fetchImpl);
  await x.checkMarketStatus();
  await Promise.resolve();
  assert.equal(x.S.fx.configured,true);
  await x.fetchPracticeCandles();
  const outbound=observed.find(x=>x.url==="/api/market/fetch");
  assert.equal(outbound.method,"POST");
  assert.equal(outbound.headers["X-Trader-Token"],"local-session-token");
  assert.deepEqual(JSON.parse(outbound.body),{symbol:"EUR_USD",count:500});
  assert.equal(outbound.body.includes("password"),false);
  await x.loadPracticeCandles();
  assert.equal(x.S.data.source,"oanda-fxpractice");
  assert.equal(x.S.data.symbol,"EUR_USD");
  assert.equal(x.S.data.bars.length,2);
  assert.equal(x.S.data.bars[0].bidClose,1.10025);
  assert.equal(x.packet().source.kind,"oanda-fxpractice");
  x.nodes.mesConfirm.checked=true;
  await x.runMesResearch();
  assert.equal(x.S.mesRun,null);
});
test("offline standalone workspace leaves provider controls disabled",async()=>{
  const x=await createUI();
  await x.checkMarketStatus();
  assert.equal(x.S.fx.server,false);
  assert.equal(x.nodes.fxFetch.disabled,true);
  assert.equal(x.nodes.fxLoad.disabled,true);
});
