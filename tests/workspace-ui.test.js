import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const html=readFileSync(join(dirname(fileURLToPath(import.meta.url)),"../prototype/trader-workspace.html"),"utf8");
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];

function mockRuntime(){
  assert.ok(script);
  const painting=["clearRect","fillRect","setTransform","save","restore","beginPath","rect","clip",
    "moveTo","lineTo","stroke","fill","fillText","setLineDash","strokeRect","arc","closePath"];
  const ctx=Object.fromEntries(painting.map(name=>[name,()=>{}]));
  class Element{
    constructor(id){this.id=id;this.value=id==="scanFilter"?"all":"";this.checked=false;this.listeners={};
      this.dataset={};this.style={};this.children=[];this.clientWidth=1050;this.clientHeight=490;
      this.classList={add(){},remove(){},toggle(){}}}
    addEventListener(name,cb){(this.listeners[name]??=[]).push(cb)}
    append(...children){this.children.push(...children)}
    appendChild(child){this.children.push(child);return child}
    remove(){}
    setAttribute(){}
    getBoundingClientRect(){return {left:0,top:0,width:1050,height:490}}
    setPointerCapture(){}
    releasePointerCapture(){}
    getContext(){return ctx}
  }
  const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  const groups=Object.fromEntries(["tool","view","strategy","prompt","scope","ai-mode"].map(type=>
    [type,[...html.matchAll(new RegExp('data-'+type+'="([^"]+)"','g'))].map(x=>{
      const e=new Element(x[1]);e.dataset[type.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=x[1];return e;
    })]));
  const document={getElementById:id=>nodes[id],createElement:tag=>new Element(tag),
    querySelectorAll:selector=>groups[selector.match(/\[data-([a-z-]+)\]/)?.[1]]||[],
    documentElement:new Element("html"),body:new Element("body"),addEventListener(){}};
  const window={addEventListener(){},matchMedia(){return {matches:false}}};
  const inner=script.slice(script.indexOf("(function(){")+"(function(){".length,script.lastIndexOf("})();"));
  const code=inner.replace(/\n\s*start\(\);\s*$/,
    '\n return start().then(()=>({S,setTool,handleClick,handleDown,handleMove,handleUp,zoomAt,visible,scanHistory,activeDrawings,removeMark}));');
  assert.notEqual(inner,code,"Must replace start with an awaitable bootstrap");
  const run=new Function("document","window","indexedDB","localStorage","devicePixelRatio",
    "requestAnimationFrame","ResizeObserver","setTimeout","clearTimeout",code);
  return run(document,window,undefined,{getItem(){return null},setItem(){}},1,cb=>cb(),
    class {observe(){}},()=>1,()=>{}).then(runtime=>({...runtime,nodes}));
}
test("UI boots, finds historical candidates, zooms and annotates",async()=>{
  const {S,nodes,visible,setTool,handleClick,handleDown,handleMove,handleUp,zoomAt,removeMark}=await mockRuntime();
  assert.equal(S.data.source,"synthetic");
  assert.ok(S.candidates.length>0);
  assert.ok(S.selectedCandidate);
  assert.equal(visible().bars.length,90);
  zoomAt(35,.5);
  assert.equal(visible().bars.length,35);
  setTool("level",true);
  handleClick({clientX:500,clientY:220});
  assert.equal(S.drawings.length,1);
  setTool("line",true);
  handleDown({button:0,clientX:260,clientY:170,pointerId:1});
  handleMove({clientX:540,clientY:240,pointerId:1});
  handleUp({clientX:540,clientY:240,pointerId:1});
  assert.deepEqual(S.drawings.map(x=>x.type),["level","line"]);
  assert.ok(nodes.drawingList.children.length>=2);
  setTool("select",true);
  handleDown({button:0,clientX:260,clientY:170,pointerId:2});
  handleMove({clientX:480,clientY:170,pointerId:2});
  handleUp({clientX:480,clientY:170,pointerId:2});
  assert.ok(S.selection[1]>S.selection[0]);
  removeMark(S.drawings[0].id);
  assert.deepEqual(S.drawings.map(x=>x.type),["line"]);
});
test("replay separates annotations and candidate detection",async()=>{
  const {S,scanHistory,activeDrawings,setTool,handleClick}=await mockRuntime();
  S.replay=true;S.reveal=79;S.replayDrawings=[];S.selectedCandidate=null;
  scanHistory();
  assert.ok(S.candidates.every(c=>c.index<=79));
  setTool("note",true);
  handleClick({clientX:500,clientY:220});
  assert.ok(S.replayDrawings.length>0);
  const original=S.replayDrawings[0].createdReveal;
  S.reveal=original-2;
  assert.equal(activeDrawings().length,0,"Future replay annotations must disappear");
});
