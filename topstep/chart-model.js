/* Deterministic chart viewport geometry, independent of canvas and broker transport. */
(function(root){
"use strict";
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function range(total,visible=110,end=total){
 if(!Number.isSafeInteger(total)||total<0)throw Error("Invalid candle count");
 if(total===0)return {start:0,end:0,count:0,total:0};
 if(!Number.isFinite(visible)||!Number.isFinite(end))throw Error("Invalid viewport");
 const count=clamp(Math.round(visible),1,total);
 const actualEnd=clamp(Math.round(end),count,total);
 return {start:actualEnd-count,end:actualEnd,count,total};
}
function zoom(total,visible,end,factor,fraction=.5){
 const old=range(total,visible,end);
 if(!old.count)return old;
 if(!Number.isFinite(factor)||factor<=0||!Number.isFinite(fraction))throw Error("Invalid zoom");
 const pivot=clamp(fraction,0,1);
 const nextCount=clamp(Math.round(old.count*factor),Math.min(15,total),total);
 if(nextCount===old.count)return old;
 const anchor=old.start+pivot*(old.count-1);
 const nextStart=Math.round(anchor-pivot*(nextCount-1));
 return range(total,nextCount,nextStart+nextCount);
}
function pan(total,visible,end,deltaBars){
 const old=range(total,visible,end);
 if(!old.count)return old;
 if(!Number.isFinite(deltaBars))throw Error("Invalid pan");
 return range(total,old.count,old.end-Math.round(deltaBars));
}
function hit(r,x,left,right){
 if(!r||r.count===0||!Number.isFinite(x)||right<=left)return null;
 const proportion=clamp((x-left)/(right-left),0,1-1e-10);
 return r.start+Math.floor(proportion*r.count);
}
function geometry(bars,view,width,height){
 if(!Array.isArray(bars)||!Number.isFinite(width)||!Number.isFinite(height)||
    width<=110||height<=100)throw Error("Invalid chart dimensions");
 const r=range(bars.length,view?.count??110,view?.end??bars.length);
 if(!r.count)return {range:r,candles:[],left:14,right:width-70,top:18,bottom:height-30};
 const selected=bars.slice(r.start,r.end);
 const lo=Math.min(...selected.map(c=>c.low));
 const hi=Math.max(...selected.map(c=>c.high));
 if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo<=0||hi<lo)
   throw Error("Invalid candle prices");
 const pad=Math.max((hi-lo)*.07,1e-8);
 const min=lo-pad,max=hi+pad;
 const left=14,right=width-70,top=18,bottom=height-31;
 const step=(right-left)/r.count;
 const widthBar=Math.max(.8,Math.min(16,step*.72));
 const y=price=>top+(max-price)/(max-min)*(bottom-top);
 return {range:r,left,right,top,bottom,min,max,step,widthBar,y,
   candles:selected.map((c,i)=>({...c,x:left+(i+.5)*step, yHigh:y(c.high),
     yLow:y(c.low),yOpen:y(c.open),yClose:y(c.close)}))};
}
root.TraderChart=Object.freeze({range,zoom,pan,hit,geometry});
})(typeof globalThis!=="undefined"?globalThis:this);
