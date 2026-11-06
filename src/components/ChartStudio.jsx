import React, { useEffect, useRef, useState } from "react";
import CandleCanvas from "./CandleCanvas";
import { buildDemoSeries, importMarketCsv, utcLabel } from "../lib/marketData";
import { getChartRecord, listChartRecords, putChartRecord, removeChartRecord, exportChartArchive } from "../lib/chartStore";

const DEMO = buildDemoSeries();
const tools = [
  ["inspect","Inspect"], ["level","Price level"], ["trend","Trendline"], ["pen","Draw"], ["note","Note pin"],
];
const control = "rounded-lg border border-white/10 px-3 py-2 text-xs font-medium transition hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed";
const input = "rounded-lg border border-white/10 bg-[#121b28] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/40";
const panel = "rounded-2xl border border-white/10 bg-[#0d131d] p-4";
const nowIso = () => new Date().toISOString();
const unique = () => typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function snapshotSvgWithPins(snapshot) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(snapshot.svg,"image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("Snapshot image could not be read");
  const ns = "http://www.w3.org/2000/svg";
  for (const pin of snapshot.pins || []) {
    const group = doc.createElementNS(ns,"g");
    const dot = doc.createElementNS(ns,"circle");
    dot.setAttribute("cx",String(pin.x*1040)); dot.setAttribute("cy",String(pin.y*528)); dot.setAttribute("r","11");
    dot.setAttribute("fill","#eec676"); dot.setAttribute("stroke","#09111b"); dot.setAttribute("stroke-width","2");
    const label = doc.createElementNS(ns,"text");
    label.setAttribute("x",String(Math.min(850,pin.x*1040+16)));
    label.setAttribute("y",String(Math.max(22,pin.y*528-8)));
    label.setAttribute("fill","#fff2d5"); label.setAttribute("font-size","13");
    label.setAttribute("font-family","system-ui,sans-serif");
    label.textContent=String(pin.text || "Note").slice(0,50);
    group.appendChild(dot);group.appendChild(label);doc.documentElement.appendChild(group);
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}
async function exportPng(snapshot) {
  const svg = snapshotSvgWithPins(snapshot);
  const url = URL.createObjectURL(new Blob([svg],{type:"image/svg+xml;charset=utf-8"}));
  try {
    const img = new window.Image();
    await new Promise((resolve,reject) => {
      img.onload=resolve; img.onerror=() => reject(new Error("PNG rendering failed"));
      img.src=url;
    });
    const canvas = document.createElement("canvas");canvas.width=2080;canvas.height=1056;
    const ctx=canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas renderer unavailable");
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    if (!blob) throw new Error("PNG export failed");
    saveBlob(blob,"trader-snapshot-"+snapshot.id+".png");
  } finally {URL.revokeObjectURL(url);}
}
function displayTime(value) {return new Date(value).toLocaleString();}
function labelAnnotation(shape) {
  if (shape.type === "note") return shape.text || "Chart note";
  if (shape.type === "level") return "Horizontal level";
  if (shape.type === "trend") return "Trendline";
  return "Freehand drawing";
}

export default function ChartStudio({trades = []}) {
  const [dataset,setDataset] = useState(DEMO);
  const [annotations,setAnnotations] = useState([]);
  const [snapshots,setSnapshots] = useState([]);
  const [tool,setTool] = useState("inspect");
  const [selectedAnnotation,setSelectedAnnotation] = useState("");
  const [replay,setReplay] = useState(false);
  const [replayEnd,setReplayEnd] = useState(79);
  const [windowSize,setWindowSize] = useState(90);
  const [focus,setFocus] = useState(null);
  const [selectedTradeId,setSelectedTradeId] = useState("");
  const [snapshotNote,setSnapshotNote] = useState("");
  const [selectedSnapshotId,setSelectedSnapshotId] = useState("");
  const [pinText,setPinText] = useState("");
  const [pinMode,setPinMode] = useState(false);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [ready,setReady] = useState(false);
  const svgRef = useRef(null);
  const fileRef = useRef(null);
  const loadCounter = useRef(0);
  const saveQueue = useRef(Promise.resolve());
  const snapshotRef = useRef([]);
  const endIndex = replay ? Math.min(replayEnd,dataset.candles.length-1) : dataset.candles.length-1;
  const firstVisible = Math.max(0,endIndex-windowSize+1);
  const visible = dataset.candles.slice(firstVisible,endIndex+1);
  const selected = snapshots.find(x=>x.id===selectedSnapshotId) || snapshots[0] || null;
  const selectedShape = annotations.find(a=>a.id===selectedAnnotation);

  useEffect(() => {
    let active=true;
    async function load() {
      try {
        const [setting,loaded] = await Promise.all([getChartRecord("settings","activeDataset"),listChartRecords("snapshots")]);
        if (!active) return;
        snapshotRef.current=loaded.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
        setSnapshots(snapshotRef.current);
        if (setting?.datasetId && setting.datasetId !== DEMO.id) {
          const record=await getChartRecord("datasets",setting.datasetId);
          if (active && record?.candles) setDataset(record);
        }
      } catch (e) {if(active)setError("Local chart storage: "+e.message);}
      finally {if(active)setReady(true);}
    }
    load();
    return ()=>{active=false;};
  },[]);

  useEffect(()=>{
    const seq=++loadCounter.current;
    setAnnotations([]);
    setSelectedAnnotation("");
    getChartRecord("annotations",dataset.id)
      .then(record=>{if (seq===loadCounter.current) setAnnotations(record?.list || []);})
      .catch(e=>setError("Loading drawings: "+e.message));
  },[dataset.id]);

  function saveAnnotations(next) {
    setAnnotations(next);
    putChartRecord("annotations",{id:dataset.id,list:next,updatedAt:nowIso()}).catch(e=>setError("Could not save drawings: "+e.message));
  }
  function addAnnotation(shape) {saveAnnotations([...annotations,shape]);}
  function editAnnotation(id,changes) {saveAnnotations(annotations.map(a=>a.id===id?{...a,...changes}:a));}
  function deleteAnnotation(id) {
    saveAnnotations(annotations.filter(a=>a.id!==id));
    if(selectedAnnotation===id)setSelectedAnnotation("");
  }

  async function importFile(event) {
    const file=event.target.files?.[0];if(!file)return;
    setBusy(true);setError("");
    try {
      if(file.size>8000000)throw new Error("Choose a CSV under 8 MB");
      const text=await file.text();
      const next=await importMarketCsv(text,file.name.replace(/\.[^.]+$/,"").slice(0,36));
      await putChartRecord("datasets",next);
      await putChartRecord("settings",{id:"activeDataset",datasetId:next.id});
      setDataset(next);setReplay(false);setFocus(null);
    } catch(e){setError(e.message);}
    finally {setBusy(false);if(fileRef.current)fileRef.current.value="";}
  }
  async function restoreDemo() {
    try {await putChartRecord("settings",{id:"activeDataset",datasetId:DEMO.id});setDataset(DEMO);setReplay(false);setFocus(null);setError("");}
    catch(e){setError(e.message);}
  }

  function capture() {
    if (!svgRef.current || !visible.length || !ready) return;
    try {
      const node=svgRef.current.cloneNode(true);
      node.setAttribute("xmlns","http://www.w3.org/2000/svg");
      node.setAttribute("width","1040");node.setAttribute("height","528");
      const record={
        id:unique(),createdAt:nowIso(),datasetId:dataset.id,source:dataset.kind,
        sourceLabel:dataset.label,symbol:dataset.symbol,timeframe:dataset.timeframe,
        firstTime:visible[0].time,lastTime:visible[visible.length-1].time,
        capturedBarCount:visible.length,candles:visible.map(c=>({...c})),
        annotations:annotations.map(a=>({...a})), linkedTradeId:selectedTradeId || null,
        originalNote:snapshotNote.trim(),reviewNotes:"",pins:[],
        svg:new XMLSerializer().serializeToString(node),
      };
      putChartRecord("snapshots",record).then(()=>{
        const next=[record,...snapshotRef.current];
        snapshotRef.current=next;setSnapshots(next);setSelectedSnapshotId(record.id);
        setSnapshotNote("");setPinMode(false);setError("");
      }).catch(e=>setError("Snapshot save failed: "+e.message));
    } catch(e){setError(e.message);}
  }
  function patchSnapshot(id,patch) {
    const next=snapshotRef.current.map(s=>s.id===id?{...s,...patch}:s);
    const changed=next.find(s=>s.id===id);
    if(!changed)return;
    snapshotRef.current=next;setSnapshots(next);
    // Serializes rapid text edits so an older write cannot overwrite a newer one.
    saveQueue.current=saveQueue.current.catch(()=>{}).then(()=>putChartRecord("snapshots",changed))
      .catch(e=>setError("Snapshot edit not saved: "+e.message));
  }
  function placePin(event) {
    if(!selected || !pinMode || !pinText.trim())return;
    const rect=event.currentTarget.getBoundingClientRect();
    const px=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
    const py=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));
    patchSnapshot(selected.id,{pins:[...(selected.pins||[]),{id:unique(),x:px,y:py,text:pinText.trim()}]});
    setPinText("");setPinMode(false);
  }
  async function deleteSnapshot(id) {
    if(!window.confirm("Permanently delete this snapshot and its notes?"))return;
    try {
      await removeChartRecord("snapshots",id);
      const next=snapshotRef.current.filter(s=>s.id!==id);
      snapshotRef.current=next;setSnapshots(next);
      if(selectedSnapshotId===id)setSelectedSnapshotId(next[0]?.id || "");
    }catch(e){setError(e.message);}
  }
  async function archive() {
    try{saveBlob(new Blob([await exportChartArchive()],{type:"application/json"}),"trader-chart-archive-"+new Date().toISOString().slice(0,10)+".json");}
    catch(e){setError("Backup failed: "+e.message);}
  }
  const imageSource=selected?"data:image/svg+xml;charset=utf-8,"+encodeURIComponent(selected.svg):"";
  return <div className="space-y-4 text-zinc-100">
    <section className="rounded-[1.6rem] border border-white/10 bg-gradient-to-br from-[#161d29] to-[#0c121d] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[.17em] text-emerald-300">Visual trading workbench</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">Chart Studio</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-400">Draw on real imported OHLC data or practice on explicitly synthetic candles. Visual replay only; no trade execution.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={"rounded-full border px-3 py-1.5 text-xs font-medium " + (dataset.kind==="synthetic"?"border-amber-400/30 bg-amber-400/10 text-amber-200":"border-cyan-400/30 bg-cyan-400/10 text-cyan-200")}>{dataset.label}</span>
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" onChange={importFile} className="hidden"/>
          <button type="button" onClick={()=>fileRef.current?.click()} disabled={busy} className={control}>{busy?"Importing...":"Import OHLC CSV"}</button>
          <button type="button" onClick={restoreDemo} className={control}>Demo</button>
          <button type="button" onClick={archive} className={control}>Backup archive</button>
        </div>
      </div>
    </section>
    {error && <div role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">{error}</div>}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
      <div className="min-w-0 space-y-3">
        <div className={panel}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3"><div className="text-lg font-semibold">{dataset.symbol}</div>
              <span className="text-xs text-zinc-500">{dataset.timeframe} · {dataset.candles.length.toLocaleString()} candles · UTC</span></div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-zinc-400"><input type="checkbox" checked={replay} onChange={e=>{setReplay(e.target.checked);setReplayEnd(Math.min(79,dataset.candles.length-1));}}/> Historical reveal</label>
              <select className={input} aria-label="Visible candle count" value={windowSize} onChange={e=>setWindowSize(Number(e.target.value))}>
                {[40,90,140].map(n=><option key={n} value={n}>{n} bars</option>)}
              </select>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5" role="toolbar" aria-label="Chart annotation tools">
            {tools.map(([value,label])=><button type="button" key={value} aria-pressed={tool===value} onClick={()=>setTool(value)} className={control+" "+(tool===value?"border-emerald-400/40 bg-emerald-400/10 text-emerald-100":"text-zinc-400")}>{label}</button>)}
            <button type="button" onClick={()=>{setTool("inspect");setSelectedAnnotation("");}} className={control+" text-zinc-500"}>Exit drawing</button>
          </div>
          <CandleCanvas key={dataset.id} chartRef={svgRef} candles={dataset.candles} endIndex={endIndex}
            visibleCount={windowSize} annotations={annotations} tool={tool} selectedId={selectedAnnotation}
            onFocus={setFocus} onAddAnnotation={addAnnotation} onSelectAnnotation={setSelectedAnnotation}/>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
            <span>{focus ? "Selected candle: "+utcLabel(focus.time)+"Z · O "+focus.open.toFixed(2)+" / H "+focus.high.toFixed(2)+" / L "+focus.low.toFixed(2)+" / C "+focus.close.toFixed(2) : "Click a candle to inspect it. Two clicks create a trendline. Hold and drag to draw."}</span>
            <span>Drawings anchored to this imported dataset</span>
          </div>
          {replay && <div className="mt-4 rounded-xl border border-white/10 bg-[#121c29] p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <strong className="text-xs font-medium text-amber-200">Historical reveal · chart-only training</strong>
              <span className="text-xs text-zinc-400">{endIndex+1} / {dataset.candles.length} candles revealed</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" disabled={endIndex<=Math.min(79,dataset.candles.length-1)} onClick={()=>setReplayEnd(v=>Math.max(Math.min(79,dataset.candles.length-1),v-1))} className={control}>−1</button>
              <input aria-label="Historical reveal position" type="range" min={Math.min(79,dataset.candles.length-1)} max={dataset.candles.length-1} value={endIndex} onChange={e=>setReplayEnd(Number(e.target.value))} className="min-w-0 flex-1 accent-emerald-400"/>
              <button type="button" disabled={endIndex>=dataset.candles.length-1} onClick={()=>setReplayEnd(v=>Math.min(dataset.candles.length-1,v+1))} className={control}>+1</button>
              <button type="button" disabled={endIndex>=dataset.candles.length-1} onClick={()=>setReplayEnd(v=>Math.min(dataset.candles.length-1,v+10))} className={control}>+10</button>
            </div>
          </div>}
        </div>
        <div className={panel}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-zinc-100">Capture a chart snapshot</h3>
              <p className="mt-1 text-xs text-zinc-500">Records visible bars, chart markup, source, timestamp and optional linked trade.</p></div>
            <button type="button" onClick={capture} disabled={!ready} className="rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-[#092018] hover:bg-emerald-300 disabled:opacity-40">Capture snapshot</button>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[220px_1fr]">
            <select className={input} aria-label="Attach snapshot to a journal trade" value={selectedTradeId} onChange={e=>setSelectedTradeId(e.target.value)}>
              <option value="">Not linked to a trade</option>
              {[...trades].slice(-150).reverse().map(t=><option key={t.id} value={t.id}>{t.date} · {t.market} · {t.setup}</option>)}
            </select>
            <input value={snapshotNote} onChange={e=>setSnapshotNote(e.target.value)} className={input} placeholder="What are you trying to remember about this chart?"/>
          </div>
        </div>
      </div>
      <aside className="space-y-3">
        <section className={panel}>
          <h3 className="text-sm font-semibold">Chart drawings</h3>
          <p className="mt-1 text-xs text-zinc-500">{annotations.length} notes and shapes on this dataset</p>
          <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
            {annotations.map(a=><div key={a.id} className={"flex items-center gap-1 rounded-lg border px-2 py-1.5 "+(a.id===selectedAnnotation?"border-emerald-500/30 bg-emerald-400/[.06]":"border-white/5")}>
              <button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-zinc-300" onClick={()=>setSelectedAnnotation(a.id)}>{labelAnnotation(a)}</button>
              <button type="button" title="Delete drawing" aria-label={"Delete "+labelAnnotation(a)} onClick={()=>deleteAnnotation(a.id)} className="px-2 text-sm text-zinc-500 hover:text-red-300">×</button>
            </div>)}
            {!annotations.length && <p className="py-5 text-xs text-zinc-500">Add a price level, trendline, drawing, or note pin on the chart.</p>}
          </div>
          {selectedShape?.type==="note" && <div className="mt-3">
            <label htmlFor="chart-mark-note" className="mb-2 block text-xs text-zinc-400">Selected chart note</label>
            <textarea id="chart-mark-note" rows={3} className={input+" w-full resize-y"} value={selectedShape.text||""} onChange={e=>editAnnotation(selectedShape.id,{text:e.target.value})}/>
          </div>}
        </section>
        <section className={panel}>
          <h3 className="text-sm font-semibold">Snapshot library</h3>
          <p className="mt-1 text-xs text-zinc-500">Persistent in this browser profile (IndexedDB)</p>
          <div className="mt-3 max-h-[400px] space-y-2 overflow-y-auto">
            {snapshots.map(s=><button type="button" key={s.id} onClick={()=>{setSelectedSnapshotId(s.id);setPinMode(false);}}
              className={"w-full rounded-xl border p-3 text-left "+(selected?.id===s.id?"border-emerald-400/30 bg-emerald-400/[.07]":"border-white/10 bg-[#131b27] hover:bg-white/10")}>
              <div className="flex justify-between gap-2"><span className="truncate text-xs font-semibold">{s.symbol}</span><span className="text-[11px] text-zinc-500">{s.source==="synthetic"?"DEMO":"CSV"}</span></div>
              <div className="mt-1 text-xs text-zinc-400">{displayTime(s.createdAt)}</div>
              <div className="mt-1 truncate text-xs text-zinc-500">{s.originalNote||"No initial note"}</div>
            </button>)}
            {!snapshots.length && <p className="py-5 text-xs text-zinc-500">Saved snapshots will appear here after capture.</p>}
          </div>
        </section>
        <section className={panel}>
          <h3 className="text-sm font-semibold">Provenance</h3>
          <p className="mt-2 break-all text-xs leading-6 text-zinc-500">Dataset: {dataset.id}</p>
          <p className="mt-2 text-xs leading-5 text-zinc-500">This studio does not receive live prices, execute trades, assess real P/L, or independently verify CSV source quality. Drawings and imports do not constitute a tested strategy.</p>
        </section>
      </aside>
    </div>

    {selected && <section className={panel}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-base font-semibold">Snapshot review · {selected.symbol}</h3>
          <p className="mt-1 text-xs text-zinc-500">{displayTime(selected.createdAt)} · {selected.capturedBarCount} captured candles · {selected.sourceLabel}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={()=>exportPng(selected).catch(e=>setError(e.message))} className={control}>Export PNG with pins</button>
          <button type="button" onClick={()=>saveBlob(new Blob([JSON.stringify(selected,null,2)],{type:"application/json"}),"snapshot-"+selected.id+".json")} className={control}>Export record</button>
          <button type="button" onClick={()=>deleteSnapshot(selected.id)} className={control+" text-red-300"}>Delete</button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
        <div>
          <div role="button" tabIndex={pinMode?0:-1} aria-label="Saved chart image: when pin mode is enabled, click to place a note" onClick={placePin} onKeyDown={e=>{if(e.key==="Enter"&&pinMode){e.preventDefault();setError("Click directly on the chart image to place your pin.");}}}
            className={"relative overflow-hidden rounded-xl border border-white/10 bg-[#0b1018] "+(pinMode?"cursor-crosshair ring-1 ring-amber-300/60":"")}>
            <img src={imageSource} alt={"Captured "+selected.symbol+" OHLC chart with its original annotations"} className="block w-full" draggable={false}/>
            {(selected.pins||[]).map((p,i)=><button type="button" key={p.id} title={p.text} onClick={e=>e.stopPropagation()}
              className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-[#0c121a] bg-amber-300 text-[11px] font-bold text-[#1c1709] shadow-lg"
              style={{left:p.x*100+"%",top:p.y*100+"%"}}>{i+1}</button>)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input aria-label="Note to pin onto saved chart" value={pinText} onChange={e=>setPinText(e.target.value)} className={input+" min-w-[220px] flex-1"} placeholder="Write an observation to pin to the image..."/>
            <button type="button" disabled={!pinText.trim()} onClick={()=>setPinMode(v=>!v)} className={control+" "+(pinMode?"border-amber-300/50 bg-amber-300/10 text-amber-200":"")}>{pinMode?"Click image to place":"Place note pin"}</button>
          </div>
        </div>
        <div className="space-y-3">
          <div><p className="text-xs uppercase tracking-wider text-zinc-500">Captured context</p>
            <p className="mt-1 text-xs leading-6 text-zinc-300">{selected.originalNote||"No original note"}</p>
            <p className="mt-1 text-xs text-zinc-500">Visible: {utcLabel(selected.firstTime)}Z to {utcLabel(selected.lastTime)}Z</p>
            <p className="mt-1 text-xs text-zinc-500">Linked trade: {selected.linkedTradeId||"None"}</p></div>
          <div><label htmlFor="snapshot-review-text" className="mb-2 block text-xs font-medium text-zinc-300">Ongoing review notes</label>
            <textarea id="snapshot-review-text" value={selected.reviewNotes||""} onChange={e=>patchSnapshot(selected.id,{reviewNotes:e.target.value})} rows={6}
              className={input+" w-full resize-y"} placeholder="Analyze this setup, your decisions, the outcome, and lessons..."/></div>
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {(selected.pins||[]).map((p,i)=><div key={p.id} className="flex items-start gap-2 rounded-lg border border-white/10 p-2">
              <span className="rounded-full bg-amber-300 px-2 py-1 text-xs font-bold text-zinc-950">{i+1}</span>
              <span className="min-w-0 flex-1 break-words text-xs text-zinc-300">{p.text}</span>
              <button type="button" aria-label={"Delete snapshot pin "+(i+1)} onClick={()=>patchSnapshot(selected.id,{pins:selected.pins.filter(x=>x.id!==p.id)})} className="text-xs text-red-300">Remove</button>
            </div>)}
          </div>
        </div>
      </div>
    </section>}
  </div>;
}
