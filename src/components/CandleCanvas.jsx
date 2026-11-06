import React, { useMemo, useRef, useState } from "react";
import { utcLabel } from "../lib/marketData";

const W = 1040, H = 528, LEFT = 38, RIGHT = 89, TOP = 23, BOTTOM = 42;
const PW = W - LEFT - RIGHT, PH = H - TOP - BOTTOM;
const UP = "#38c8a0", DOWN = "#f07484", INK = "#f5c572";

function priceText(price, span) {
  const dp = span < .1 ? 5 : span < 1 ? 4 : span < 10 ? 3 : span < 100 ? 2 : 1;
  return Number(price).toFixed(dp);
}
function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random();
}

/** Pure SVG chart: candle and drawing coordinates are stored in bar-index + price space.
 * Drawings are valid only for the exact dataset ID. Data is NEVER fetched or traded here.
 */
export default function CandleCanvas({
  candles = [], endIndex, visibleCount = 90, annotations = [], tool = "inspect",
  selectedId = null, onAddAnnotation, onSelectAnnotation, onFocus, chartRef,
}) {
  const [hover, setHover] = useState(null);
  const [pending, setPending] = useState(null);
  const [draft, setDraft] = useState([]);
  const penRef = useRef(null);
  const firstIndex = Math.max(0, Math.min(endIndex + 1, candles.length) - visibleCount);
  const lastIndex = Math.min(endIndex, candles.length - 1);
  const visible = useMemo(() => candles.slice(firstIndex, lastIndex + 1), [candles, firstIndex, lastIndex]);
  const high = visible.length ? Math.max(...visible.map(c => c.high)) : 1;
  const low = visible.length ? Math.min(...visible.map(c => c.low)) : 0;
  const pad = Math.max((high-low)*.11, Math.max(1, high)*.00005);
  const maxY = high+pad, minY = low-pad;
  const span = maxY-minY;
  const step = PW / Math.max(visible.length,1);
  const x = i => LEFT + (i-firstIndex+.5) * step;
  const y = p => TOP + (maxY-p)/span*PH;
  const inside = point => point.index >= firstIndex-1 && point.index <= lastIndex+1;
  function pointForEvent(event) {
    const r = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX-r.left)*W/Math.max(r.width,1);
    const py = (event.clientY-r.top)*H/Math.max(r.height,1);
    if (px < LEFT || px > W-RIGHT || py < TOP || py > H-BOTTOM || !visible.length) return null;
    return { index: Math.max(firstIndex, Math.min(lastIndex, firstIndex + (px-LEFT)/step-.5)), price: maxY-(py-TOP)/PH*span };
  }
  function submit(type, props) {
    const shape = { id: newId(), type, createdAt: new Date().toISOString(), ...props };
    onAddAnnotation?.(shape);
    onSelectAnnotation?.(shape.id);
    return shape;
  }
  function pointerDown(event) {
    const p = pointForEvent(event);
    if (!p) return;
    if (tool === "pen") {
      penRef.current = [p]; setDraft([p]);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) {}
    }
  }
  function pointerMove(event) {
    const p = pointForEvent(event);
    setHover(p);
    if (tool === "pen" && penRef.current && p) {
      const last = penRef.current[penRef.current.length-1];
      if (Math.abs(last.index-p.index) > .06 || Math.abs(last.price-p.price) > span*.003) {
        const points = [...penRef.current,p].slice(-3000);
        penRef.current = points; setDraft(points);
      }
    }
  }
  function pointerUp(event) {
    if (tool !== "pen" || !penRef.current) return;
    const points = penRef.current;
    penRef.current = null; setDraft([]);
    if (points.length > 1) submit("pen",{ points });
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (_) {}
  }
  function click(event) {
    if (tool === "pen") return;
    const p = pointForEvent(event);
    if (!p) return;
    const bar = candles[Math.round(p.index)];
    onFocus?.(bar || null);
    if (tool === "level") submit("level", {point:p});
    if (tool === "note") submit("note", {point:p, text:"New chart note"});
    if (tool === "trend") {
      if (!pending) setPending(p);
      else { submit("trend",{start:pending,end:p}); setPending(null); }
    }
    if (tool === "inspect") setPending(null);
  }
  function pathOf(points) {
    if (!points?.length) return "";
    return points.map((p,i) => (i ? "L" : "M") + x(p.index).toFixed(2) + "," + y(p.price).toFixed(2)).join(" ");
  }
  const ticks = Array.from({length:6},(_,i)=>maxY-(span*i/5));
  const timeMarks = visible.filter((_,i) => i % Math.max(1,Math.ceil(visible.length/7)) === 0);
  return <svg
    ref={chartRef} viewBox={"0 0 " + W + " " + H} width="100%" height="auto"
    xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Interactive OHLC chart; demo until you import verified market candles"
    style={{display:"block", touchAction:"none", userSelect:"none", background:"#0b1018", borderRadius:12, fontFamily:"Inter, system-ui, sans-serif"}}
  >
    <defs>
      <clipPath id="chart-visible-plot"><rect x={LEFT} y={TOP} width={PW} height={PH}/></clipPath>
      <marker id="chart-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill={INK}/></marker>
    </defs>
    <rect width={W} height={H} fill="#0b1018"/>
    <rect x={LEFT} y={TOP} width={PW} height={PH} fill="#0e1520"/>
    {ticks.map((price,i) => <g key={"p"+i}>
      <line x1={LEFT} y1={y(price)} x2={W-RIGHT} y2={y(price)} stroke="#354254" strokeWidth=".75" opacity=".6" strokeDasharray="3 5"/>
      <text x={W-RIGHT+13} y={y(price)+4} fontSize="12" fill="#9aa9bb">{priceText(price,span)}</text>
    </g>)}
    {timeMarks.map(c => {
      const idx = candles.indexOf(c);
      return <g key={c.time}>
        <line x1={x(idx)} y1={TOP} x2={x(idx)} y2={H-BOTTOM} stroke="#293343" strokeWidth=".65" strokeDasharray="2 7"/>
        <text x={x(idx)} y={H-17} fill="#8b9aab" fontSize="12" textAnchor="middle">{utcLabel(c.time)}Z</text>
      </g>;
    })}
    <g clipPath="url(#chart-visible-plot)">
      {visible.map((c,i) => {
        const idx = firstIndex+i; const center=x(idx), green=c.close>=c.open, color=green?UP:DOWN;
        const bodyY=Math.min(y(c.open),y(c.close));
        const bodyHeight=Math.max(1.3,Math.abs(y(c.close)-y(c.open)));
        return <g key={c.time}>
          <line x1={center} x2={center} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={Math.min(1.6, Math.max(1,step*.2))}/>
          <rect x={center-Math.max(1.5,step*.3)} y={bodyY} width={Math.max(3,Math.min(17,step*.6))} height={bodyHeight} fill={color} rx=".6" />
        </g>;
      })}
      {annotations.map(a => {
        const selected=a.id === selectedId;
        const color=selected?"#fff1bb":INK;
        if (a.type === "level" && a.point) return <g key={a.id}>
          <line x1={LEFT} x2={W-RIGHT} y1={y(a.point.price)} y2={y(a.point.price)} stroke={color} strokeWidth={selected?2.3:1.5} strokeDasharray="8 5"/>
          <text x={LEFT+7} y={y(a.point.price)-6} fontSize="12" fill={color}>LEVEL {priceText(a.point.price,span)}</text>
        </g>;
        if (a.type === "trend" && a.start && a.end && (inside(a.start)||inside(a.end))) return <line key={a.id} x1={x(a.start.index)} y1={y(a.start.price)} x2={x(a.end.index)} y2={y(a.end.price)} stroke={color} strokeWidth={selected?3:2} strokeLinecap="round" />;
        if (a.type === "pen" && a.points) return <path key={a.id} d={pathOf(a.points)} fill="none" stroke={color} strokeWidth={selected?3:2.2} strokeLinecap="round" strokeLinejoin="round"/>;
        if (a.type === "note" && a.point && inside(a.point)) return <g key={a.id}>
          <circle cx={x(a.point.index)} cy={y(a.point.price)} r={selected?10:8} fill="#dbb25e" stroke="#101720" strokeWidth="2"/>
          <text x={x(a.point.index)} y={y(a.point.price)+4} textAnchor="middle" fill="#101720" fontWeight="700" fontSize="12">N</text>
          <text x={x(a.point.index)+14} y={y(a.point.price)-11} fill="#f5ddad" fontSize="12">{(a.text || "Note").slice(0,37)}</text>
        </g>;
        return null;
      })}
      {pending && tool === "trend" && hover && <line x1={x(pending.index)} y1={y(pending.price)} x2={x(hover.index)} y2={y(hover.price)} stroke="#eee0ad" strokeWidth="1.5" strokeDasharray="4 3"/>}
      {draft.length > 1 && <path d={pathOf(draft)} fill="none" stroke="#f7d991" strokeWidth="2.4" strokeLinecap="round"/>}
      {hover && <g opacity=".68" pointerEvents="none">
        <line x1={x(hover.index)} x2={x(hover.index)} y1={TOP} y2={H-BOTTOM} stroke="#adc0d4" strokeWidth=".8" strokeDasharray="4 5"/>
        <line x1={LEFT} x2={W-RIGHT} y1={y(hover.price)} y2={y(hover.price)} stroke="#adc0d4" strokeWidth=".8" strokeDasharray="4 5"/>
      </g>}
    </g>
    <rect x={LEFT} y={TOP} width={PW} height={PH} fill="transparent" style={{cursor:tool==="inspect"?"crosshair":"crosshair"}}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
      onPointerCancel={() => { penRef.current=null;setDraft([]); }} onPointerLeave={() => { if (!penRef.current) setHover(null); }} onClick={click}/>
    <text x={LEFT+8} y={TOP+20} fontWeight="700" fill="#8294a9" fontSize="12">UTC · CANDLES · {visible.length} VISIBLE</text>
    {!visible.length && <text x={W/2} y={H/2} fill="#a9b7c7" fontSize="17" textAnchor="middle">Import candles or switch to a demo dataset</text>}
  </svg>;
}
