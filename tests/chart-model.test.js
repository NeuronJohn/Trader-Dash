import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const source=readFileSync(new URL("../topstep/chart-model.js",import.meta.url),"utf8");
const context={};runInNewContext(source,context);
const chart=context.TraderChart;
const bars=Array.from({length:240},(_,i)=>({
  time:i*300000,open:6000+i*.25,high:6001+i*.25,
  low:5999+i*.25,close:6000+i*.25
}));

test("tail window and panning into earlier history stay bounded",()=>{
  const initial=chart.range(240,80);
  assert.equal(initial.start,160);
  assert.equal(initial.end,240);
  const p=chart.pan(240,80,240,30);
  assert.equal(p.start,130);
  assert.equal(p.end,210);
  assert.equal(chart.pan(240,80,200,10000).start,0);
  assert.equal(chart.pan(240,80,210,-10000).end,240);
});

test("zooming around cursor preserves selected historical bar",()=>{
  const original=chart.range(240,100,210);
  const fraction=.27;
  const before=original.start+fraction*(original.count-1);
  const changed=chart.zoom(240,100,210,.73,fraction);
  const after=changed.start+fraction*(changed.count-1);
  assert.ok(Math.abs(before-after)<=1,"cursor should remain on same candle");
  assert.equal(changed.count,73);
});

test("zoom out clamps to total available bars",()=>{
  const x=chart.zoom(60,50,60,20,.5);
  assert.equal(x.count,60);
  assert.equal(x.start,0);
  assert.equal(x.end,60);
});

test("hit testing maps cursor to the actual visible index",()=>{
  const view=chart.range(240,80,200);
  assert.equal(chart.hit(view,14,14,814),120);
  assert.equal(chart.hit(view,814,14,814),199);
  assert.equal(chart.hit(view,414,14,814),160);
});

test("geometry keeps OHLC positions, body widths and prices consistent across zoom",()=>{
  for(const n of [20,50,150,230]){
    const v=chart.range(240,n,220);
    const m=chart.geometry(bars,v,1100,400);
    assert.equal(m.candles.length,n);
    assert.ok(m.widthBar>0);
    assert.ok(m.step>0);
    for(const c of m.candles){
      assert.ok(c.yHigh<=Math.min(c.yOpen,c.yClose));
      assert.ok(c.yLow>=Math.max(c.yOpen,c.yClose));
      assert.ok(c.x>=m.left&&c.x<=m.right);
    }
  }
});

test("no bars, invalid prices and dimensions do not invent chart data",()=>{
  assert.equal(chart.geometry([],chart.range(0),1000,400).candles.length,0);
  assert.throws(()=>chart.range(-1,40),/Invalid/);
  assert.throws(()=>chart.geometry([{high:0,low:1}],chart.range(1),1000,400),/Invalid/);
  assert.throws(()=>chart.geometry(bars,chart.range(240),80,400),/Invalid/);
});

test("multiple pans and zooms never use future indexes beyond last bar",()=>{
  let view=chart.range(240,110,150);
  for(let i=0;i<50;i++){
    view=chart.zoom(240,view.count,view.end,i%2?.8:1.35,(i%7)/6);
    view=chart.pan(240,view.count,view.end,i*17-300);
    assert.ok(view.start>=0);
    assert.ok(view.end<=240);
    assert.equal(view.end-view.start,view.count);
  }
});
