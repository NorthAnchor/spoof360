import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════
//  CONSTANTS & STORAGE
// ═══════════════════════════════════════════════════════
const SK = {
  pin: "s360_pin_v1",
  trips: "s360_trips_v1",
  schedules: "s360_scheds_v1",
  battery: "s360_batt_v1",
  wifi: "s360_wifi_v1",
  tz: "s360_tz_v1",
  altitude: "s360_alt_v1",
  geofences: "s360_geo_v1",
  settings: "s360_settings_v1",
};
const ld = (k, d) => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d; } catch { return d; } };
const sv = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ═══════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════
const fmtTime = (ms) => { const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60); return `${String(h).padStart(2,"0")}:${String(m%60).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`; };
const fmtCoord = (n) => n==null?"—":n.toFixed(6);
const mps2kph = (v) => v==null?null:v*3.6;
const nowHHMM = () => { const d=new Date(); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; };
const timeToDate = (t) => { const [h,m]=t.split(":").map(Number),d=new Date(); d.setHours(h,m,0,0); return d; };
const msUntil = (t) => { let d=timeToDate(t)-Date.now(); if(d<0)d+=86400000; return d; };

function haversine(a,b) {
  const R=6371000,φ1=(a.lat*Math.PI)/180,φ2=(b.lat*Math.PI)/180,Δφ=((b.lat-a.lat)*Math.PI)/180,Δλ=((b.lng-a.lng)*Math.PI)/180;
  const x=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

function getActivity(kph) {
  if(kph==null) return {label:"Unknown",   icon:"❓",color:"#5eead4",bg:"#0a1628"};
  if(kph<1)     return {label:"Stationary",icon:"🧍",color:"#94a3b8",bg:"#111827"};
  if(kph<8)     return {label:"Walking",   icon:"🚶",color:"#4ade80",bg:"#052e16"};
  if(kph<25)    return {label:"Cycling",   icon:"🚴",color:"#fbbf24",bg:"#1c1003"};
  if(kph<120)   return {label:"Driving",   icon:"🚗",color:"#38bdf8",bg:"#0c1a2e"};
  return              {label:"Fast",      icon:"✈️", color:"#f97316",bg:"#1a0e00"};
}

function tripStats(pts) {
  if(!pts||pts.length<2) return {dist:0,duration:0,avgKph:0,maxKph:0};
  let dist=0,maxKph=0;
  for(let i=1;i<pts.length;i++){
    dist+=haversine(pts[i-1],pts[i]);
    const k=mps2kph(pts[i].spd); if(k!=null&&k>maxKph)maxKph=k;
  }
  const duration=pts.at(-1).ts-pts[0].ts;
  return {dist,duration,avgKph:duration>0?(dist/1000)/(duration/3600000):0,maxKph};
}

function enrichSpeeds(pts) {
  return pts.map((pt,i)=>{
    if(pt.spd!=null)return pt;
    if(i===0)return{...pt,spd:0};
    const p=pts[i-1],dt=(pt.ts-p.ts)/1000;
    return{...pt,spd:dt>0?haversine(p,pt)/dt:0};
  });
}

// Realistic walking motion data generator
function genMotion(kph) {
  if(kph==null||kph<1) return {x:0,y:9.81,z:0};
  const t=Date.now()/1000;
  if(kph<8){ // walking
    return {x:Math.sin(t*6)*1.2,y:9.81+Math.sin(t*12)*0.8,z:Math.cos(t*6)*0.4};
  } else if(kph<25){ // cycling
    return {x:Math.sin(t*4)*0.6,y:9.81+Math.sin(t*8)*0.3,z:Math.cos(t*3)*0.5};
  } else { // driving
    return {x:Math.sin(t*2)*0.3,y:9.81+Math.sin(t*4)*0.15,z:Math.cos(t*1.5)*0.2};
  }
}

// TIMEZONES
const TIMEZONES = [
  {label:"Local (Real)",tz:""},
  {label:"New York (EST)",tz:"America/New_York"},
  {label:"Chicago (CST)",tz:"America/Chicago"},
  {label:"Denver (MST)",tz:"America/Denver"},
  {label:"Los Angeles (PST)",tz:"America/Los_Angeles"},
  {label:"London (GMT)",tz:"Europe/London"},
  {label:"Paris (CET)",tz:"Europe/Paris"},
  {label:"Dubai (GST)",tz:"Asia/Dubai"},
  {label:"Tokyo (JST)",tz:"Asia/Tokyo"},
  {label:"Sydney (AEST)",tz:"Australia/Sydney"},
];

// ═══════════════════════════════════════════════════════
//  CALCULATOR STEALTH SCREEN
// ═══════════════════════════════════════════════════════
function Calculator({onUnlock}) {
  const [display,setDisplay]=useState("0");
  const [expr,setExpr]=useState("");
  const PIN=ld(SK.pin,"");

  const press=(val)=>{
    if(val==="C"){setDisplay("0");setExpr("");return;}
    if(val==="="){
      const attempt=expr+display;
      if(attempt===PIN){onUnlock();return;}
      try{const r=eval(attempt.replace(/[^0-9+\-*/.]/g,""));setDisplay(String(r));setExpr("");}
      catch{setDisplay("Error");setExpr("");}
      return;
    }
    if(["+","-","×","÷"].includes(val)){
      setExpr(expr+(display==="0"?"":display)+(val==="×"?"*":val==="÷"?"/":val));
      setDisplay("0");return;
    }
    if(val==="."){
      if(!display.includes("."))setDisplay(display+"."); return;
    }
    setDisplay(display==="0"?val:display+val);
  };

  const rows=[["7","8","9","÷"],["4","5","6","×"],["1","2","3","-"],["C","0",".","+"],["","","","="]];
  return (
    <div style={{minHeight:"100vh",background:"#1a1a2e",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",paddingBottom:24}}>
      <div style={{width:"100%",maxWidth:380,padding:"0 16px"}}>
        <div style={{background:"#0f0f1a",borderRadius:16,padding:"20px 20px 8px",marginBottom:8,textAlign:"right"}}>
          <div style={{fontSize:13,color:"#334155",minHeight:20,fontFamily:"monospace"}}>{expr}</div>
          <div style={{fontSize:48,color:"#e2e8f0",fontFamily:"monospace",fontWeight:200,letterSpacing:-2}}>{display}</div>
        </div>
        {rows.map((row,ri)=>(
          <div key={ri} style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:10}}>
            {row.map((btn,bi)=>(
              <button key={bi} onClick={()=>btn&&press(btn)} style={{
                height:70,borderRadius:14,border:"none",cursor:btn?"pointer":"default",fontSize:24,fontWeight:300,
                background:btn==="="?"#f97316":btn==="C"?"#334155":btn==="0"?"#1e293b":"#1e293b",
                color:btn==="="?"#fff":"#e2e8f0",fontFamily:"monospace",
                opacity:btn?1:0,transition:"opacity .15s, transform .1s",
                transform:"scale(1)",
              }}>{btn}</button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  PIN SETUP SCREEN
// ═══════════════════════════════════════════════════════
function PinSetup({onDone}) {
  const [pin,setPin]=useState("");
  const [confirm,setConfirm]=useState("");
  const [step,setStep]=useState(1); // 1=enter, 2=confirm
  const [err,setErr]=useState("");

  const press=(d)=>{
    if(step===1){
      const n=pin+d;
      setPin(n);
      if(n.length===4){setStep(2);}
    } else {
      const n=confirm+d;
      setConfirm(n);
      if(n.length===4){
        if(n===pin){sv(SK.pin,n);onDone();}
        else{setErr("PINs don't match. Try again.");setPin("");setConfirm("");setStep(1);}
      }
    }
  };
  const del=()=>{ if(step===1)setPin(p=>p.slice(0,-1)); else setConfirm(c=>c.slice(0,-1)); };
  const current=step===1?pin:confirm;

  return (
    <div style={{minHeight:"100vh",background:"#0a0e1a",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{fontSize:32,marginBottom:8}}>🛡️</div>
      <div style={{fontSize:22,fontWeight:700,color:"#5eead4",letterSpacing:2,marginBottom:4,fontFamily:"monospace"}}>SPOOF 360</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:32,letterSpacing:1}}>{step===1?"SET YOUR PIN":"CONFIRM YOUR PIN"}</div>
      {err&&<div style={{color:"#f87171",fontSize:13,marginBottom:16}}>{err}</div>}
      <div style={{display:"flex",gap:16,marginBottom:40}}>
        {[0,1,2,3].map(i=>(
          <div key={i} style={{width:16,height:16,borderRadius:"50%",background:i<current.length?"#5eead4":"#1e293b",border:"2px solid #334155",transition:"background .2s"}}/>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,width:240}}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i)=>(
          <button key={i} onClick={()=>d===""?null:d==="⌫"?del():press(String(d))} style={{
            height:64,borderRadius:12,border:"1px solid #1e293b",background:"#0d1b2a",
            color:d===""?"transparent":"#e2e8f0",fontSize:22,cursor:d===""?"default":"pointer",
            fontFamily:"monospace",fontWeight:300,
          }}>{d}</button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  PIN UNLOCK SCREEN
// ═══════════════════════════════════════════════════════
function PinUnlock({onUnlock}) {
  const [pin,setPin]=useState("");
  const [err,setErr]=useState("");
  const correct=ld(SK.pin,"");

  const press=(d)=>{
    const n=pin+d;
    setPin(n);
    if(n.length===4){
      if(n===correct){onUnlock();}
      else{setErr("Incorrect PIN");setPin("");}
    }
  };
  const del=()=>{setPin(p=>p.slice(0,-1));setErr("");};

  return (
    <div style={{minHeight:"100vh",background:"#0a0e1a",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{fontSize:32,marginBottom:8}}>🔐</div>
      <div style={{fontSize:22,fontWeight:700,color:"#5eead4",letterSpacing:2,marginBottom:4,fontFamily:"monospace"}}>SPOOF 360</div>
      <div style={{fontSize:13,color:"#64748b",marginBottom:32,letterSpacing:1}}>ENTER PIN TO UNLOCK</div>
      {err&&<div style={{color:"#f87171",fontSize:13,marginBottom:16,animation:"shake .3s"}}>{err}</div>}
      <div style={{display:"flex",gap:16,marginBottom:40}}>
        {[0,1,2,3].map(i=>(
          <div key={i} style={{width:16,height:16,borderRadius:"50%",background:i<pin.length?"#5eead4":"#1e293b",border:"2px solid #334155",transition:"background .2s"}}/>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,width:240}}>
        {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((d,i)=>(
          <button key={i} onClick={()=>d===""?null:d==="⌫"?del():press(String(d))} style={{
            height:64,borderRadius:12,border:"1px solid #1e293b",background:"#0d1b2a",
            color:d===""?"transparent":"#e2e8f0",fontSize:22,cursor:d===""?"default":"pointer",
            fontFamily:"monospace",fontWeight:300,
          }}>{d}</button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  MINI MAP (OpenStreetMap via iframe/tile)
// ═══════════════════════════════════════════════════════
function MiniMap({points,currentIdx,center}) {
  const canvasRef=useRef(null);

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas||!points||points.length<2)return;
    const ctx=canvas.getContext("2d");
    const W=canvas.width,H=canvas.height;
    ctx.clearRect(0,0,W,H);

    // Find bounds
    const lats=points.map(p=>p.lat),lngs=points.map(p=>p.lng);
    const minLat=Math.min(...lats),maxLat=Math.max(...lats);
    const minLng=Math.min(...lngs),maxLng=Math.max(...lngs);
    const pad=0.1;
    const latRange=(maxLat-minLat)||0.001,lngRange=(maxLng-minLng)||0.001;

    const toXY=(lat,lng)=>({
      x:((lng-minLng)/lngRange*(1-2*pad)+pad)*W,
      y:((maxLat-lat)/latRange*(1-2*pad)+pad)*H,
    });

    // Draw grid
    ctx.strokeStyle="#1e3a5f";ctx.lineWidth=0.5;
    for(let i=0;i<=4;i++){
      ctx.beginPath();ctx.moveTo(i*W/4,0);ctx.lineTo(i*W/4,H);ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,i*H/4);ctx.lineTo(W,i*H/4);ctx.stroke();
    }

    // Draw full route (dim)
    ctx.beginPath();ctx.strokeStyle="#1e4060";ctx.lineWidth=2;ctx.setLineDash([4,4]);
    points.forEach((p,i)=>{ const {x,y}=toXY(p.lat,p.lng); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.stroke();ctx.setLineDash([]);

    // Draw traveled portion
    if(currentIdx>0){
      ctx.beginPath();ctx.strokeStyle="#5eead4";ctx.lineWidth=3;
      points.slice(0,currentIdx+1).forEach((p,i)=>{ const {x,y}=toXY(p.lat,p.lng); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
      ctx.stroke();
    }

    // Start marker
    const s=toXY(points[0].lat,points[0].lng);
    ctx.fillStyle="#4ade80";ctx.beginPath();ctx.arc(s.x,s.y,6,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#fff";ctx.font="bold 8px monospace";ctx.textAlign="center";ctx.fillText("S",s.x,s.y+3);

    // End marker
    const e=toXY(points.at(-1).lat,points.at(-1).lng);
    ctx.fillStyle="#f97316";ctx.beginPath();ctx.arc(e.x,e.y,6,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#fff";ctx.fillText("E",e.x,e.y+3);

    // Current position
    if(currentIdx>=0&&currentIdx<points.length){
      const c=toXY(points[currentIdx].lat,points[currentIdx].lng);
      ctx.fillStyle="#5eead4";
      ctx.beginPath();ctx.arc(c.x,c.y,8,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(c.x,c.y,8,0,Math.PI*2);ctx.stroke();
      // Pulse ring
      ctx.strokeStyle="#5eead444";ctx.lineWidth=3;ctx.beginPath();ctx.arc(c.x,c.y,14,0,Math.PI*2);ctx.stroke();
    }
  },[points,currentIdx]);

  if(!points||points.length<2) return null;

  return (
    <div style={{background:"#080d17",borderRadius:12,border:"1px solid #1e3a5f",overflow:"hidden",marginBottom:12,position:"relative"}}>
      <div style={{position:"absolute",top:8,left:10,fontSize:10,color:"#5eead4",letterSpacing:2,zIndex:1,background:"#080d17cc",padding:"2px 6px",borderRadius:4}}>ROUTE MAP</div>
      <canvas ref={canvasRef} width={360} height={200} style={{width:"100%",height:200,display:"block"}}/>
      <div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",borderTop:"1px solid #1e3a5f"}}>
        <span style={{fontSize:10,color:"#4ade80"}}>● Start</span>
        <span style={{fontSize:10,color:"#5eead4"}}>● Current</span>
        <span style={{fontSize:10,color:"#f97316"}}>● End</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  SPEED GAUGE
// ═══════════════════════════════════════════════════════
function SpeedGauge({kph,label,activity}) {
  const pct=Math.min((kph??0)/160,1),angle=-135+pct*270;
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
      <svg width="140" height="92" viewBox="0 0 140 92">
        <path d="M 15 85 A 55 55 0 1 1 125 85" fill="none" stroke="#1e3a5f" strokeWidth="10" strokeLinecap="round"/>
        {pct>0&&<path d="M 15 85 A 55 55 0 1 1 125 85" fill="none" stroke={activity.color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${pct*172.8} 172.8`}/>}
        <g transform={`rotate(${angle},70,85)`}>
          <line x1="70" y1="85" x2="70" y2="38" stroke={activity.color} strokeWidth="2.5" strokeLinecap="round"/>
          <circle cx="70" cy="85" r="5" fill={activity.color}/>
        </g>
        <text x="70" y="76" textAnchor="middle" fill={activity.color} fontSize="18" fontWeight="bold" fontFamily="monospace">{kph!=null?kph.toFixed(1):"—"}</text>
        <text x="70" y="88" textAnchor="middle" fill="#475569" fontSize="9" fontFamily="monospace">km/h</text>
      </svg>
      <div style={{background:activity.bg,border:`1px solid ${activity.color}44`,borderRadius:20,padding:"4px 14px",fontSize:12,fontWeight:700,color:activity.color,letterSpacing:1}}>
        {activity.icon} {activity.label}
      </div>
      {label&&<div style={{fontSize:10,color:"#475569",letterSpacing:2}}>{label}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  ACTIVITY BAR
// ═══════════════════════════════════════════════════════
function ActivityBar({pts}) {
  if(!pts||pts.length<2)return null;
  const b={};
  pts.forEach(p=>{const n=getActivity(mps2kph(p.spd)).label;b[n]=(b[n]||0)+1;});
  const total=pts.length,kf=n=>n==="Walking"?3:n==="Cycling"?15:n==="Driving"?60:n==="Fast"?130:0;
  const entries=Object.entries(b).filter(([,v])=>v>0);
  return (
    <div style={{background:"#080d17",border:"1px solid #1e3a5f",borderRadius:10,padding:"10px 14px",marginBottom:12}}>
      <div style={{fontSize:10,color:"#475569",letterSpacing:2,marginBottom:6}}>ACTIVITY BREAKDOWN</div>
      <div style={{display:"flex",height:8,borderRadius:4,overflow:"hidden",marginBottom:6}}>
        {entries.map(([n,c])=>{const a=getActivity(kf(n));return<div key={n} style={{flex:c,background:a.color}}/>;} )}
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:"3px 10px"}}>
        {entries.map(([n,c])=>{const a=getActivity(kf(n));return<span key={n} style={{fontSize:10,color:a.color}}>{a.icon} {n} {((c/total)*100).toFixed(0)}%</span>;} )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  BATTERY WIDGET
// ═══════════════════════════════════════════════════════
const BATT_DEF={pct:100,charging:true,health:"Good",temp:28,voltage:4200,show:true};
function BatteryBar({cfg}) {
  if(!cfg.show)return null;
  return (
    <div style={{position:"absolute",right:12,top:16,display:"flex",alignItems:"center",gap:4}}>
      <div style={{fontSize:11,color:"#4ade80",fontWeight:700,fontFamily:"monospace"}}>{cfg.pct}%</div>
      {cfg.charging&&<div style={{fontSize:12}}>⚡</div>}
      <div style={{width:26,height:12,border:"1.5px solid #4ade80",borderRadius:3,position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",left:0,top:0,bottom:0,width:`${cfg.pct}%`,background:cfg.pct>20?"#4ade80":"#f87171"}}/>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  SCHEDULE END SCREEN
// ═══════════════════════════════════════════════════════
function ScheduleEndScreen({onDismiss}) {
  return (
    <div style={{position:"fixed",inset:0,background:"#0a0e1aee",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:9999,padding:24}}>
      <div style={{background:"#0d1b2a",border:"2px solid #4ade80",borderRadius:16,padding:"28px 24px",maxWidth:380,width:"100%",textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:12}}>✅</div>
        <div style={{fontSize:20,fontWeight:700,color:"#4ade80",letterSpacing:2,marginBottom:8,fontFamily:"monospace"}}>SCHEDULE COMPLETE</div>
        <div style={{fontSize:13,color:"#94a3b8",lineHeight:1.7,marginBottom:20}}>All scheduled trips and waits have finished. GPS spoofing stopped.</div>
        <div style={{background:"#080d17",border:"1px solid #1e3a5f",borderRadius:10,padding:"14px",textAlign:"left",marginBottom:20}}>
          <div style={{fontSize:11,color:"#fbbf24",letterSpacing:2,marginBottom:8}}>📱 RE-ENABLE REAL GPS:</div>
          <div style={{fontSize:12,color:"#94a3b8",lineHeight:1.9}}>
            1. Settings → <span style={{color:"#5eead4"}}>Developer Options</span><br/>
            2. Tap <span style={{color:"#5eead4"}}>Mock location app</span><br/>
            3. Select <span style={{color:"#5eead4"}}>"None"</span><br/>
            4. Real GPS is now active ✓
          </div>
        </div>
        <button style={{...S.btn,...S.btnGreen}} onClick={onDismiss}>↩ Back to Spoof 360</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  SCHEDULE BLOCK EDITOR
// ═══════════════════════════════════════════════════════
function BlockEditor({block,index,trips,onUpdate,onDelete,onUp,onDown,isFirst,isLast}) {
  const trip=trips.find(t=>t.id===block.tripId);
  const col=block.type==="trip"?"#38bdf8":block.type==="stationary"?"#4ade80":"#fbbf24";
  return (
    <div style={{background:"#0d1b2a",border:`1px solid ${col}33`,borderRadius:10,padding:"12px",marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <span>{block.type==="trip"?"🗺️":block.type==="stationary"?"🧍":"⏱️"}</span>
          <span style={{fontSize:12,fontWeight:700,color:col,letterSpacing:1}}>{block.type.toUpperCase()} — Block {index+1}</span>
        </div>
        <div style={{display:"flex",gap:4}}>
          {!isFirst&&<button style={S.iconBtn} onClick={onUp}>↑</button>}
          {!isLast&&<button style={S.iconBtn} onClick={onDown}>↓</button>}
          <button style={{...S.iconBtn,color:"#f87171"}} onClick={onDelete}>✕</button>
        </div>
      </div>
      <label style={S.miniLabel}>Start Time</label>
      <input type="time" value={block.startTime||""} onChange={e=>onUpdate({...block,startTime:e.target.value})} style={S.timeInput}/>
      {block.type==="trip"&&<>
        <label style={S.miniLabel}>Trip</label>
        <select style={S.miniSel} value={block.tripId||""} onChange={e=>onUpdate({...block,tripId:Number(e.target.value)||null})}>
          <option value="">— select trip —</option>
          {trips.map(t=><option key={t.id} value={t.id}>{getActivity(t.stats?.avgKph??null).icon} {t.name}</option>)}
        </select>
        {trip&&<ActivityBar pts={trip.points}/>}
        <label style={S.miniLabel}>Speed: {block.speed||1}×</label>
        <input type="range" min="0.25" max="10" step="0.25" value={block.speed||1} onChange={e=>onUpdate({...block,speed:Number(e.target.value)})} style={{width:"100%",accentColor:"#38bdf8",marginBottom:8}}/>
      </>}
      {block.type==="stationary"&&<>
        <label style={S.miniLabel}>Location</label>
        <select style={S.miniSel} value={block.locationSrc||"last"} onChange={e=>onUpdate({...block,locationSrc:e.target.value})}>
          <option value="last">End of previous trip</option>
          <option value="next">Start of next trip</option>
          <option value="trip">Specific trip start</option>
          <option value="coords">Manual coordinates</option>
        </select>
        {block.locationSrc==="trip"&&<select style={S.miniSel} value={block.tripId||""} onChange={e=>onUpdate({...block,tripId:Number(e.target.value)||null})}>
          <option value="">— select trip —</option>
          {trips.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select>}
        {block.locationSrc==="coords"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div><label style={S.miniLabel}>Lat</label><input style={S.miniInput} type="number" step="0.000001" value={block.lat||""} onChange={e=>onUpdate({...block,lat:parseFloat(e.target.value)})}/></div>
          <div><label style={S.miniLabel}>Lng</label><input style={S.miniInput} type="number" step="0.000001" value={block.lng||""} onChange={e=>onUpdate({...block,lng:parseFloat(e.target.value)})}/></div>
        </div>}
        <label style={S.miniLabel}>Stay Until</label>
        <input type="time" value={block.endTime||""} onChange={e=>onUpdate({...block,endTime:e.target.value})} style={S.timeInput}/>
      </>}
      {block.type==="wait"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <div><label style={S.miniLabel}>Hours</label><input style={S.miniInput} type="number" min="0" max="23" value={block.waitH||0} onChange={e=>onUpdate({...block,waitH:Number(e.target.value)})}/></div>
        <div><label style={S.miniLabel}>Minutes</label><input style={S.miniInput} type="number" min="0" max="59" value={block.waitM||0} onChange={e=>onUpdate({...block,waitM:Number(e.target.value)})}/></div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  SCHEDULE EDITOR
// ═══════════════════════════════════════════════════════
function ScheduleEditor({sched,trips,onChange,onSave,onCancel}) {
  const add=(type)=>onChange({...sched,blocks:[...sched.blocks,{id:Date.now(),type,startTime:nowHHMM(),speed:1,locationSrc:"last",waitH:0,waitM:30}]});
  const upd=(i,b)=>{const bl=[...sched.blocks];bl[i]=b;onChange({...sched,blocks:bl});};
  const del=(i)=>onChange({...sched,blocks:sched.blocks.filter((_,j)=>j!==i)});
  const mv=(i,d)=>{const bl=[...sched.blocks],t=i+d;if(t<0||t>=bl.length)return;[bl[i],bl[t]]=[bl[t],bl[i]];onChange({...sched,blocks:bl});};

  // timeline
  const preview=[];
  let cur=sched.blocks[0]?.startTime?timeToDate(sched.blocks[0].startTime):new Date();
  sched.blocks.forEach((b,i)=>{
    const start=new Date(cur);
    if(b.type==="trip"){const trip=trips.find(t=>t.id===b.tripId);const dur=trip?((trip.points.at(-1)?.ts||0)/(b.speed||1)):0;cur=new Date(cur.getTime()+dur);preview.push({i,label:`Trip: ${trip?.name||"?"}`,start,end:new Date(cur),color:"#38bdf8"});}
    else if(b.type==="stationary"){const end=b.endTime?timeToDate(b.endTime):new Date(cur.getTime()+3600000);let dur=end-cur;if(dur<0)dur+=86400000;cur=new Date(cur.getTime()+dur);preview.push({i,label:"Stationary",start,end:new Date(cur),color:"#4ade80"});}
    else{const dur=((b.waitH||0)*3600+(b.waitM||0)*60)*1000;cur=new Date(cur.getTime()+dur);preview.push({i,label:`Wait ${b.waitH||0}h ${b.waitM||0}m`,start,end:new Date(cur),color:"#fbbf24"});}
  });

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color:"#5eead4",fontFamily:"monospace"}}>SCHEDULE EDITOR</div>
        <button style={{...S.iconBtn,color:"#94a3b8"}} onClick={onCancel}>✕ Cancel</button>
      </div>
      <label style={S.miniLabel}>Schedule Name</label>
      <input style={S.input} placeholder="e.g. Monday Routine" value={sched.name} onChange={e=>onChange({...sched,name:e.target.value})}/>
      {preview.length>0&&<div style={{background:"#080d17",border:"1px solid #1e3a5f",borderRadius:10,padding:"10px 14px",marginBottom:14}}>
        <div style={{fontSize:10,color:"#475569",letterSpacing:2,marginBottom:8}}>TIMELINE PREVIEW</div>
        {preview.map((p,i)=>(
          <div key={i} style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:p.color,flexShrink:0}}/>
            <div style={{fontSize:11,color:p.color,flex:1}}>{p.label}</div>
            <div style={{fontSize:10,color:"#475569"}}>{p.start.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})} → {p.end.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
          </div>
        ))}
      </div>}
      {sched.blocks.map((b,i)=><BlockEditor key={b.id} block={b} index={i} trips={trips} onUpdate={nb=>upd(i,nb)} onDelete={()=>del(i)} onUp={()=>mv(i,-1)} onDown={()=>mv(i,1)} isFirst={i===0} isLast={i===sched.blocks.length-1}/>)}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
        <button style={{...S.btn,background:"#0c1a2e",border:"1px solid #38bdf844",color:"#38bdf8",padding:"10px 4px",fontSize:12,marginBottom:0}} onClick={()=>add("trip")}>＋ Trip</button>
        <button style={{...S.btn,background:"#052e16",border:"1px solid #4ade8044",color:"#4ade80",padding:"10px 4px",fontSize:12,marginBottom:0}} onClick={()=>add("stationary")}>＋ Stay</button>
        <button style={{...S.btn,background:"#1c1003",border:"1px solid #fbbf2444",color:"#fbbf24",padding:"10px 4px",fontSize:12,marginBottom:0}} onClick={()=>add("wait")}>＋ Wait</button>
      </div>
      <button style={{...S.btn,...S.btnGreen}} onClick={()=>onSave(sched)}>💾 Save Schedule</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════
const TABS=["record","replay","schedule","spoof","tools","trips"];
const TLABELS={record:"⏺",replay:"▶",schedule:"📅",spoof:"🎭",tools:"🔧",trips:"🗂"};

export default function App() {
  // Auth state
  const [authState,setAuthState]=useState(()=>{
    const pin=ld(SK.pin,"");
    if(!pin)return "setup";
    return "calc"; // show calculator by default
  });
  const [unlocked,setUnlocked]=useState(false);

  // Core state
  const [tab,setTab]=useState("record");
  const [recording,setRecording]=useState(false);
  const [points,setPoints]=useState([]);
  const [elapsed,setElapsed]=useState(0);
  const [currentPos,setCurrentPos]=useState(null);
  const [gpsError,setGpsError]=useState(null);
  const [tripName,setTripName]=useState("");
  const [tripNotes,setTripNotes]=useState("");

  // Trips
  const [trips,setTrips]=useState(()=>ld(SK.trips,[]));

  // Replay
  const [selectedTrip,setSelectedTrip]=useState(null);
  const [replaying,setReplaying]=useState(false);
  const [replayIdx,setReplayIdx]=useState(0);
  const [replayPos,setReplayPos]=useState(null);
  const [replaySpeed,setReplaySpeed]=useState(1);
  const [replayElapsed,setReplayElapsed]=useState(0);
  const [liveKphReplay,setLiveKphReplay]=useState(null);

  // Schedule
  const [schedules,setSchedules]=useState(()=>ld(SK.schedules,[]));
  const [editingSched,setEditingSched]=useState(null);
  const [runningSched,setRunningSched]=useState(null);
  const [schedStatus,setSchedStatus]=useState("");
  const [schedComplete,setSchedComplete]=useState(false);
  const [liveSchedPos,setLiveSchedPos]=useState(null);
  const [liveSchedKph,setLiveSchedKph]=useState(null);
  const [schedReplayIdx,setSchedReplayIdx]=useState(0);

  // Spoof settings
  const [battCfg,setBattCfg]=useState(()=>ld(SK.battery,BATT_DEF));
  const [wifiCfg,setWifiCfg]=useState(()=>ld(SK.wifi,{show:false,ssid:"Home_Network",security:"WPA2",strength:4}));
  const [tzCfg,setTzCfg]=useState(()=>ld(SK.tz,{enabled:false,tz:"America/New_York"}));
  const [altCfg,setAltCfg]=useState(()=>ld(SK.altitude,{enabled:false,value:0,unit:"m"}));
  const [motionCfg,setMotionCfg]=useState(()=>ld(SK.settings,{motionSpoof:false}));
  const [motionData,setMotionData]=useState({x:0,y:9.81,z:0});

  // Tools
  const [teleportAddr,setTeleportAddr]=useState("");
  const [teleportResult,setTeleportResult]=useState(null);
  const [teleportLoading,setTeleportLoading]=useState(false);
  const [geofences,setGeofences]=useState(()=>ld(SK.geofences,[]));
  const [newGeo,setNewGeo]=useState({name:"",lat:"",lng:"",radius:200,trigger:"enter",tripId:null,active:false});
  const [addingGeo,setAddingGeo]=useState(false);

  // Persist spoof settings
  useEffect(()=>sv(SK.battery,battCfg),[battCfg]);
  useEffect(()=>sv(SK.wifi,wifiCfg),[wifiCfg]);
  useEffect(()=>sv(SK.tz,tzCfg),[tzCfg]);
  useEffect(()=>sv(SK.altitude,altCfg),[altCfg]);
  useEffect(()=>sv(SK.settings,motionCfg),[motionCfg]);
  useEffect(()=>sv(SK.geofences,geofences),[geofences]);

  // Motion spoof ticker
  useEffect(()=>{
    if(!motionCfg.motionSpoof)return;
    const t=setInterval(()=>{
      const kph=replayPos?mps2kph(replayPos.spd):liveSchedKph;
      setMotionData(genMotion(kph));
    },100);
    return()=>clearInterval(t);
  },[motionCfg.motionSpoof,replayPos,liveSchedKph]);

  const watchRef=useRef(null),timerRef=useRef(null),startRef=useRef(null);
  const replayRef=useRef(null),schedRef=useRef(null),schedReplayRef=useRef(null),liveWRef=useRef(null);

  // ── RECORDING ──────────────────────────────────────
  const startRec=useCallback(()=>{
    if(!navigator.geolocation){setGpsError("Geolocation not supported.");return;}
    setPoints([]);setElapsed(0);setGpsError(null);startRef.current=Date.now();
    watchRef.current=navigator.geolocation.watchPosition(
      pos=>{const pt={lat:pos.coords.latitude,lng:pos.coords.longitude,alt:altCfg.enabled?altCfg.value:pos.coords.altitude,acc:pos.coords.accuracy,spd:pos.coords.speed,ts:Date.now()-startRef.current};setCurrentPos(pt);setPoints(p=>[...p,pt]);},
      err=>setGpsError(err.message),{enableHighAccuracy:true,maximumAge:0}
    );
    timerRef.current=setInterval(()=>setElapsed(Date.now()-startRef.current),500);
    setRecording(true);
  },[altCfg]);

  const stopRec=useCallback(()=>{
    if(watchRef.current!=null)navigator.geolocation.clearWatch(watchRef.current);
    clearInterval(timerRef.current);setRecording(false);
  },[]);

  const saveTrip=useCallback(()=>{
    if(points.length<2)return;
    const en=enrichSpeeds(points);
    const name=tripName.trim()||`Trip ${new Date().toLocaleString()}`;
    const trip={id:Date.now(),name,notes:tripNotes,points:en,savedAt:Date.now(),stats:tripStats(en)};
    const u=[trip,...trips];setTrips(u);sv(SK.trips,u);
    setTripName("");setTripNotes("");setPoints([]);setCurrentPos(null);setElapsed(0);setTab("trips");
  },[points,tripName,tripNotes,trips]);

  // ── REPLAY ─────────────────────────────────────────
  const startReplay=useCallback(()=>{
    if(!selectedTrip||selectedTrip.points.length<2)return;
    setReplayIdx(0);setReplayPos(selectedTrip.points[0]);setReplayElapsed(0);
    if(navigator.geolocation){liveWRef.current=navigator.geolocation.watchPosition(pos=>setLiveKphReplay(mps2kph(pos.coords.speed)),()=>{},{enableHighAccuracy:true,maximumAge:1000});}
    setReplaying(true);
  },[selectedTrip]);

  const stopReplay=useCallback(()=>{
    clearTimeout(replayRef.current);
    if(liveWRef.current!=null)navigator.geolocation.clearWatch(liveWRef.current);
    setReplaying(false);setLiveKphReplay(null);
  },[]);

  useEffect(()=>{
    if(!replaying||!selectedTrip)return;
    const pts=selectedTrip.points;
    const go=(i)=>{
      if(i>=pts.length){setReplaying(false);return;}
      setReplayPos(pts[i]);setReplayIdx(i);setReplayElapsed(pts[i].ts);
      if(i+1<pts.length){replayRef.current=setTimeout(()=>go(i+1),Math.max((pts[i+1].ts-pts[i].ts)/replaySpeed,50));}
      else setReplaying(false);
    };
    go(replayIdx);
    return()=>clearTimeout(replayRef.current);
  },[replaying]);

  // ── GEOFENCE CHECK ─────────────────────────────────
  useEffect(()=>{
    if(!currentPos||!geofences.length)return;
    geofences.forEach(geo=>{
      if(!geo.active||!geo.tripId)return;
      const dist=haversine(currentPos,{lat:Number(geo.lat),lng:Number(geo.lng)});
      const inside=dist<=geo.radius;
      if(geo.trigger==="enter"&&inside){/* auto start trip */}
    });
  },[currentPos,geofences]);

  // ── SCHEDULE ENGINE ────────────────────────────────
  const stopSched=useCallback(()=>{
    clearTimeout(schedRef.current);clearTimeout(schedReplayRef.current);
    if(liveWRef.current!=null)navigator.geolocation.clearWatch(liveWRef.current);
    setRunningSched(null);setLiveSchedPos(null);setLiveSchedKph(null);setSchedStatus("");
  },[]);

  function resolveStatCoord(block,blocks,idx,allTrips){
    const src=block.locationSrc||"last";
    if(src==="coords"&&block.lat!=null)return{lat:block.lat,lng:block.lng,spd:0};
    if(src==="next"){for(let i=idx+1;i<blocks.length;i++){if(blocks[i].type==="trip"){const t=allTrips.find(x=>x.id===blocks[i].tripId);if(t)return{...t.points[0],spd:0};}}}
    if(src==="trip"&&block.tripId){const t=allTrips.find(x=>x.id===block.tripId);if(t)return{...t.points[0],spd:0};}
    for(let i=idx-1;i>=0;i--){if(blocks[i].type==="trip"){const t=allTrips.find(x=>x.id===blocks[i].tripId);if(t)return{...t.points.at(-1),spd:0};}}
    return null;
  }

  const runBlock=useCallback((sched,idx,allTrips)=>{
    const blocks=sched.blocks;
    if(idx>=blocks.length){setSchedComplete(true);stopSched();return;}
    const block=blocks[idx];
    setRunningSched({sched,blockIdx:idx});

    if(block.type==="trip"){
      const trip=allTrips.find(t=>t.id===block.tripId);
      if(!trip){runBlock(sched,idx+1,allTrips);return;}
      setSchedStatus(`▶ Block ${idx+1}: "${trip.name}"`);
      const pts=trip.points,speed=block.speed||1;
      let pi=0;
      const adv=()=>{
        if(pi>=pts.length){runBlock(sched,idx+1,allTrips);return;}
        setLiveSchedPos(pts[pi]);setLiveSchedKph(mps2kph(pts[pi].spd));setSchedReplayIdx(pi);pi++;
        if(pi<pts.length){schedReplayRef.current=setTimeout(adv,Math.max((pts[pi].ts-pts[pi-1].ts)/speed,50));}
        else setTimeout(()=>runBlock(sched,idx+1,allTrips),500);
      };
      adv();return;
    }
    if(block.type==="stationary"){
      const coord=resolveStatCoord(block,blocks,idx,allTrips);
      if(coord){setLiveSchedPos(coord);setLiveSchedKph(0);}
      setSchedStatus(`🧍 Block ${idx+1}: Stationary until ${block.endTime||"?"}`);
      const end=block.endTime?timeToDate(block.endTime):null;
      let delay=end?(end-Date.now()):60000;if(delay<0)delay+=86400000;
      schedRef.current=setTimeout(()=>runBlock(sched,idx+1,allTrips),delay);return;
    }
    if(block.type==="wait"){
      const ms=((block.waitH||0)*3600+(block.waitM||0)*60)*1000;
      setSchedStatus(`⏱ Block ${idx+1}: Wait ${block.waitH||0}h ${block.waitM||0}m`);
      schedRef.current=setTimeout(()=>runBlock(sched,idx+1,allTrips),ms||1000);
    }
  },[stopSched]);

  const startSched=useCallback((sched)=>{
    stopSched();setSchedComplete(false);
    const first=sched.blocks[0];
    if(first?.startTime){const delay=msUntil(first.startTime);setSchedStatus(`⏳ Starting at ${first.startTime} (${Math.round(delay/60000)}min)`);schedRef.current=setTimeout(()=>runBlock(sched,0,trips),delay);}
    else runBlock(sched,0,trips);
  },[trips,runBlock,stopSched]);

  // ── TELEPORT ───────────────────────────────────────
  const doTeleport=async()=>{
    if(!teleportAddr.trim())return;
    setTeleportLoading(true);setTeleportResult(null);
    try{
      const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(teleportAddr)}&limit=1`);
      const d=await r.json();
      if(d.length>0){setTeleportResult({lat:parseFloat(d[0].lat),lng:parseFloat(d[0].lon),name:d[0].display_name});}
      else setTeleportResult({error:"Address not found"});
    }catch{setTeleportResult({error:"Network error"});}
    setTeleportLoading(false);
  };

  // ── DERIVED ────────────────────────────────────────
  const derivedKph=(()=>{
    const r=mps2kph(currentPos?.spd);if(r!=null)return r;
    if(points.length<2)return null;
    const a=points.at(-2),b=points.at(-1),dt=(b.ts-a.ts)/1000;
    return dt>0?(haversine(a,b)/dt)*3.6:null;
  })();
  const liveAct=getActivity(recording?derivedKph:null);
  const replayKph=replayPos?mps2kph(replayPos.spd):null;
  const replayAct=getActivity(replayKph);
  const schedAct=getActivity(liveSchedKph);
  const {dist:recDist}=points.length>1?tripStats(points):{dist:0};

  // Timezone display
  const tzDisplay=tzCfg.enabled&&tzCfg.tz
    ?new Date().toLocaleTimeString("en-US",{timeZone:tzCfg.tz,hour:"2-digit",minute:"2-digit",second:"2-digit"})
    :new Date().toLocaleTimeString();
  const [tzTick,setTzTick]=useState(0);
  useEffect(()=>{const t=setInterval(()=>setTzTick(x=>x+1),1000);return()=>clearInterval(t);},[]);

  // Auth gates
  if(authState==="setup")return<PinSetup onDone={()=>{setAuthState("calc");}}/>;
  if(authState==="calc"&&!unlocked)return<Calculator onUnlock={()=>setUnlocked(true)}/>;
  if(!unlocked)return<PinUnlock onUnlock={()=>setUnlocked(true)}/>;

  return (
    <div style={S.root}>
      {schedComplete&&<ScheduleEndScreen onDismiss={()=>setSchedComplete(false)}/>}

      {/* HEADER */}
      <header style={S.header}>
        <div>
          <div style={S.logo}>SPOOF<span style={{color:"#f97316"}}>360</span></div>
          <div style={S.subtitle}>LOCATION · MOTION · IDENTITY</div>
        </div>
        <BatteryBar cfg={battCfg}/>
      </header>

      {/* STATUS BANNERS */}
      {runningSched&&<div style={{background:"#052e16",borderBottom:"1px solid #4ade8033",padding:"7px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:11,color:"#4ade80",fontFamily:"monospace"}}>{schedStatus}</div>
        <button style={{background:"#f8717133",border:"1px solid #f87171",color:"#f87171",borderRadius:6,padding:"3px 10px",fontSize:10,cursor:"pointer",fontFamily:"monospace"}} onClick={stopSched}>⏹ STOP</button>
      </div>}
      {!runningSched&&schedStatus&&<div style={{background:"#1c1003",borderBottom:"1px solid #fbbf2433",padding:"7px 14px",display:"flex",justifyContent:"space-between"}}>
        <div style={{fontSize:11,color:"#fbbf24",fontFamily:"monospace"}}>{schedStatus}</div>
        <button style={{background:"transparent",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:12}} onClick={()=>setSchedStatus("")}>✕</button>
      </div>}
      {replaying&&<div style={{background:"#0c1a2e",borderBottom:"1px solid #38bdf833",padding:"7px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:11,color:"#38bdf8",fontFamily:"monospace"}}>▶ REPLAYING: {selectedTrip?.name}</div>
        <button style={{background:"#f8717133",border:"1px solid #f87171",color:"#f87171",borderRadius:6,padding:"3px 10px",fontSize:10,cursor:"pointer",fontFamily:"monospace"}} onClick={stopReplay}>⏹ STOP</button>
      </div>}

      {/* TABS */}
      <div style={S.tabs}>
        {TABS.map(t=><button key={t} style={{...S.tab,...(tab===t?S.tabOn:{})}} onClick={()=>setTab(t)}>
          {t==="trips"?`🗂 (${trips.length})`:TLABELS[t]}
        </button>)}
      </div>

      <div style={S.content}>

        {/* ══ RECORD ══ */}
        {tab==="record"&&<div style={S.panel}>
          {gpsError&&<div style={S.err}>⚠ {gpsError}</div>}
          <div style={{display:"flex",justifyContent:"center",padding:"10px 0",background:"#080d17",borderRadius:12,border:"1px solid #1e3a5f",marginBottom:14}}>
            <SpeedGauge kph={recording?derivedKph:null} label="CURRENT SPEED" activity={liveAct}/>
          </div>
          {recording&&<div style={{...S.banner,background:liveAct.bg,borderColor:liveAct.color+"55",color:liveAct.color}}>{liveAct.icon} {liveAct.label}</div>}
          <div style={S.grid2}>
            <Sq label="STATUS" value={recording?"🔴 REC":"⚫ IDLE"}/>
            <Sq label="POINTS" value={points.length}/>
            <Sq label="ELAPSED" value={fmtTime(elapsed)}/>
            <Sq label="DISTANCE" value={recDist>0?`${(recDist/1000).toFixed(2)}km`:"—"}/>
          </div>
          {altCfg.enabled&&<div style={{background:"#0c1a2e",border:"1px solid #38bdf833",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12,color:"#38bdf8"}}>
            ⛰ Altitude spoofed: {altCfg.value}{altCfg.unit}
          </div>}
          {currentPos&&<div style={S.coordBox}>
            <CR label="LAT" val={fmtCoord(currentPos.lat)}/>
            <CR label="LNG" val={fmtCoord(currentPos.lng)}/>
            <CR label="ALT" val={altCfg.enabled?`${altCfg.value}${altCfg.unit} (spoofed)`:currentPos.alt!=null?`${currentPos.alt?.toFixed(0)}m`:"—"} hi/>
            <CR label="SPD" val={derivedKph!=null?`${derivedKph.toFixed(1)} km/h`:"—"} hi/>
          </div>}
          {motionCfg.motionSpoof&&<div style={{background:"#052e16",border:"1px solid #4ade8033",borderRadius:8,padding:"8px 12px",marginBottom:10}}>
            <div style={{fontSize:10,color:"#475569",letterSpacing:2,marginBottom:4}}>SPOOFED ACCELEROMETER</div>
            <div style={{display:"flex",gap:16,fontSize:12,fontFamily:"monospace",color:"#4ade80"}}>
              <span>X: {motionData.x.toFixed(2)}</span>
              <span>Y: {motionData.y.toFixed(2)}</span>
              <span>Z: {motionData.z.toFixed(2)}</span>
            </div>
          </div>}
          {!recording?<button style={{...S.btn,...S.btnBlue}} onClick={startRec}>⏺ START RECORDING</button>
          :<button style={{...S.btn,...S.btnRed}} onClick={stopRec}>⏹ STOP RECORDING</button>}
          {!recording&&points.length>1&&<>
            <ActivityBar pts={points}/>
            <input style={S.input} placeholder="Trip name (optional)" value={tripName} onChange={e=>setTripName(e.target.value)}/>
            <textarea style={{...S.input,height:60,resize:"none"}} placeholder="Notes / alibi (optional — e.g. 'walked to pharmacy')" value={tripNotes} onChange={e=>setTripNotes(e.target.value)}/>
            <div style={{display:"flex",gap:8}}>
              <button style={{...S.btn,...S.btnGreen,flex:2}} onClick={saveTrip}>💾 SAVE TRIP</button>
              <button style={{...S.btn,...S.btnDiscard,flex:1}} onClick={()=>{stopRec();setPoints([]);setCurrentPos(null);setElapsed(0);}}>🗑</button>
            </div>
          </>}
          <div style={S.hint}>Open in Chrome on Android. Tap the map icon on the Replay tab to see your route drawn in real time.</div>
        </div>}

        {/* ══ REPLAY ══ */}
        {tab==="replay"&&<div style={S.panel}>
          {trips.length===0?<div style={S.empty}>No trips yet. Record one first.</div>:<>
            <label style={S.miniLabel}>Select Trip</label>
            <select style={S.miniSel} value={selectedTrip?.id??""} onChange={e=>{
              const t=trips.find(x=>x.id===Number(e.target.value));
              setSelectedTrip(t??null);stopReplay();setReplayIdx(0);setReplayPos(t?.points[0]??null);setReplayElapsed(0);
            }}>
              <option value="">— choose a trip —</option>
              {trips.map(t=><option key={t.id} value={t.id}>{getActivity(t.stats?.avgKph??null).icon} {t.name}</option>)}
            </select>
            {selectedTrip&&<>
              {selectedTrip.notes&&<div style={{background:"#0c1a2e",border:"1px solid #38bdf833",borderRadius:8,padding:"10px 12px",marginBottom:12,fontSize:12,color:"#94a3b8",lineHeight:1.6}}>
                📝 {selectedTrip.notes}
              </div>}
              <MiniMap points={selectedTrip.points} currentIdx={replayIdx}/>
              {replaying?<div style={{display:"flex",justifyContent:"space-around",padding:"10px 0",background:"#080d17",borderRadius:12,border:"1px solid #1e3a5f",marginBottom:12}}>
                <SpeedGauge kph={liveKphReplay} label="YOUR ACTUAL" activity={getActivity(liveKphReplay)}/>
                <div style={{width:1,background:"#1e3a5f"}}/>
                <SpeedGauge kph={replayKph} label="REPLAY SHOWN" activity={replayAct}/>
              </div>:<div style={{display:"flex",justifyContent:"center",padding:"10px 0",background:"#080d17",borderRadius:12,border:"1px solid #1e3a5f",marginBottom:12}}>
                <SpeedGauge kph={replayKph} label="REPLAY SPEED" activity={replayAct}/>
              </div>}
              {replaying&&<div style={{...S.banner,background:replayAct.bg,borderColor:replayAct.color+"55",color:replayAct.color}}>{replayAct.icon} REPLAYING AS: {replayAct.label}</div>}
              <ActivityBar pts={selectedTrip.points}/>
              <div style={S.grid2}>
                <Sq label="POINTS" value={selectedTrip.points.length}/>
                <Sq label="DURATION" value={fmtTime(selectedTrip.points.at(-1)?.ts??0)}/>
                <Sq label="PROGRESS" value={`${replayIdx+1}/${selectedTrip.points.length}`}/>
                <Sq label="ELAPSED" value={fmtTime(replayElapsed)}/>
              </div>
              {replayPos&&<div style={S.coordBox}>
                <CR label="LAT" val={fmtCoord(replayPos.lat)}/>
                <CR label="LNG" val={fmtCoord(replayPos.lng)}/>
                <CR label="ALT" val={altCfg.enabled?`${altCfg.value}${altCfg.unit}`:replayPos.alt!=null?`${replayPos.alt?.toFixed(0)}m`:"—"} hi/>
                <CR label="SPD" val={replayKph!=null?`${replayKph.toFixed(1)} km/h`:"—"} hi/>
              </div>}
              <div style={S.progBar}><div style={{...S.progFill,width:`${(replayIdx/Math.max(selectedTrip.points.length-1,1))*100}%`}}/></div>
              <div style={{height:10}}/>
              <label style={S.miniLabel}>Playback Speed: {replaySpeed}×</label>
              <input type="range" min="0.25" max="10" step="0.25" value={replaySpeed} onChange={e=>setReplaySpeed(Number(e.target.value))} style={{width:"100%",accentColor:"#5eead4",marginBottom:12}}/>
              {!replaying?<button style={{...S.btn,...S.btnBlue}} onClick={startReplay}>▶ START REPLAY</button>
              :<button style={{...S.btn,...S.btnRed}} onClick={stopReplay}>⏹ STOP REPLAY</button>}
            </>}
          </>}
        </div>}

        {/* ══ SCHEDULE ══ */}
        {tab==="schedule"&&<div style={S.panel}>
          {runningSched&&liveSchedPos&&<>
            <MiniMap points={runningSched.sched.blocks.find(b=>b.type==="trip"&&trips.find(t=>t.id===b.tripId))?trips.find(t=>t.id===runningSched.sched.blocks.find(b=>b.type==="trip")?.tripId)?.points||[liveSchedPos]:[liveSchedPos]} currentIdx={schedReplayIdx}/>
            <div style={{display:"flex",justifyContent:"center",padding:"10px 0",background:"#080d17",borderRadius:12,border:`1px solid ${schedAct.color}44`,marginBottom:12}}>
              <SpeedGauge kph={liveSchedKph} label="SCHEDULE SPEED" activity={schedAct}/>
            </div>
            <div style={{...S.banner,background:schedAct.bg,borderColor:schedAct.color+"55",color:schedAct.color}}>{schedAct.icon} {schedAct.label}</div>
            <div style={S.coordBox}>
              <CR label="LAT" val={fmtCoord(liveSchedPos.lat)}/>
              <CR label="LNG" val={fmtCoord(liveSchedPos.lng)}/>
              <CR label="BLOCK" val={`${(runningSched.blockIdx||0)+1} / ${runningSched.sched.blocks.length}`}/>
            </div>
          </>}
          {editingSched!==null?<ScheduleEditor sched={editingSched} trips={trips} onChange={setEditingSched}
            onSave={s=>{const u=editingSched?.id?schedules.map(x=>x.id===editingSched.id?{...s,id:x.id}:x):[{...s,id:Date.now()},...schedules];setSchedules(u);sv(SK.schedules,u);setEditingSched(null);}}
            onCancel={()=>setEditingSched(null)}/>:<>
            <button style={{...S.btn,...S.btnBlue,marginBottom:14}} onClick={()=>setEditingSched({name:"",blocks:[]})}>＋ NEW SCHEDULE</button>
            {schedules.length===0&&<div style={S.empty}>No schedules yet.</div>}
            {schedules.map(sc=><div key={sc.id} style={{background:"#0d1b2a",border:"1px solid #1e3a5f",borderRadius:10,padding:"12px",marginBottom:10}}>
              <div style={{fontSize:14,fontWeight:700,color:"#5eead4",marginBottom:4,fontFamily:"monospace"}}>{sc.name||"Unnamed"}</div>
              <div style={{fontSize:11,color:"#475569",marginBottom:10}}>{sc.blocks.length} blocks · starts {sc.blocks[0]?.startTime||"immediately"}</div>
              <div style={{display:"flex",gap:8}}>
                <button style={{...S.btn,...S.btnGreen,padding:"8px",fontSize:12,flex:2,marginBottom:0}} onClick={()=>startSched(sc)}>▶ RUN</button>
                <button style={{...S.btn,background:"#1e3a5f",color:"#7ec8e3",padding:"8px",fontSize:12,flex:1,marginBottom:0}} onClick={()=>setEditingSched({...sc})}>✏️</button>
                <button style={{...S.btn,...S.btnDiscard,padding:"8px",fontSize:12,flex:1,marginBottom:0}} onClick={()=>{const u=schedules.filter(s=>s.id!==sc.id);setSchedules(u);sv(SK.schedules,u);}}>🗑</button>
              </div>
            </div>)}
          </>}
        </div>}

        {/* ══ SPOOF ══ */}
        {tab==="spoof"&&<div style={S.panel}>

          {/* BATTERY */}
          <div style={S.spoofCard}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={S.spoofTitle}>🔋 BATTERY SPOOF</div>
              <Toggle on={battCfg.show} onChange={v=>setBattCfg({...battCfg,show:v})}/>
            </div>
            <div style={{display:"flex",justifyContent:"center",marginBottom:12}}>
              <div style={{position:"relative",width:100,height:46}}>
                <div style={{position:"absolute",inset:0,border:`2px solid ${battCfg.pct>20?"#4ade80":"#f87171"}`,borderRadius:6}}/>
                <div style={{position:"absolute",right:-7,top:"50%",transform:"translateY(-50%)",width:7,height:16,background:battCfg.pct>20?"#4ade80":"#f87171",borderRadius:"0 3px 3px 0"}}/>
                <div style={{position:"absolute",left:2,top:2,bottom:2,width:`${battCfg.pct}%`,maxWidth:"calc(100% - 4px)",background:battCfg.pct>20?"#4ade80":"#f87171",borderRadius:4,transition:"width .3s"}}/>
                <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:16,color:"#fff",fontFamily:"monospace",textShadow:"0 0 8px #000"}}>{battCfg.pct}%{battCfg.charging?" ⚡":""}</div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><label style={S.miniLabel}>% Level</label><input type="range" min="0" max="100" value={battCfg.pct} onChange={e=>setBattCfg({...battCfg,pct:Number(e.target.value)})} style={{width:"100%",accentColor:"#4ade80"}}/><div style={{textAlign:"center",color:"#4ade80",fontSize:11}}>{battCfg.pct}%</div></div>
              <div><label style={S.miniLabel}>Temperature</label><input type="range" min="0" max="60" value={battCfg.temp} onChange={e=>setBattCfg({...battCfg,temp:Number(e.target.value)})} style={{width:"100%",accentColor:"#fbbf24"}}/><div style={{textAlign:"center",color:"#fbbf24",fontSize:11}}>{battCfg.temp}°C</div></div>
              <div><label style={S.miniLabel}>Status</label><select style={S.miniSel} value={battCfg.charging?"Charging":"Discharging"} onChange={e=>setBattCfg({...battCfg,charging:e.target.value==="Charging"})}>
                <option>Charging</option><option>Discharging</option><option>Full</option>
              </select></div>
              <div><label style={S.miniLabel}>Health</label><select style={S.miniSel} value={battCfg.health} onChange={e=>setBattCfg({...battCfg,health:e.target.value})}>
                {["Good","Excellent","Overheat","Dead","Cold"].map(h=><option key={h}>{h}</option>)}
              </select></div>
              <div><label style={S.miniLabel}>Voltage (mV)</label><input type="range" min="3000" max="4400" step="10" value={battCfg.voltage} onChange={e=>setBattCfg({...battCfg,voltage:Number(e.target.value)})} style={{width:"100%",accentColor:"#38bdf8"}}/><div style={{textAlign:"center",color:"#38bdf8",fontSize:11}}>{battCfg.voltage}mV</div></div>
            </div>
          </div>

          {/* WIFI */}
          <div style={S.spoofCard}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={S.spoofTitle}>📶 WIFI SPOOF</div>
              <Toggle on={wifiCfg.show} onChange={v=>setWifiCfg({...wifiCfg,show:v})}/>
            </div>
            {wifiCfg.show&&<>
              <label style={S.miniLabel}>Network Name (SSID)</label>
              <input style={S.input} value={wifiCfg.ssid} onChange={e=>setWifiCfg({...wifiCfg,ssid:e.target.value})} placeholder="Home_Network"/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div><label style={S.miniLabel}>Security</label><select style={S.miniSel} value={wifiCfg.security} onChange={e=>setWifiCfg({...wifiCfg,security:e.target.value})}>
                  {["WPA2","WPA3","WEP","Open"].map(s=><option key={s}>{s}</option>)}
                </select></div>
                <div><label style={S.miniLabel}>Signal Bars: {wifiCfg.strength}/4</label><input type="range" min="1" max="4" value={wifiCfg.strength} onChange={e=>setWifiCfg({...wifiCfg,strength:Number(e.target.value)})} style={{width:"100%",accentColor:"#38bdf8"}}/></div>
              </div>
              <div style={{background:"#080d17",borderRadius:8,padding:"10px 14px",border:"1px solid #1e3a5f"}}>
                <div style={{fontSize:10,color:"#475569",marginBottom:4}}>DISPLAYS AS:</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{fontSize:18}}>{"▂▄▆█".slice(0,wifiCfg.strength)}</div>
                  <div style={{fontSize:14,color:"#e2e8f0",fontFamily:"monospace"}}>{wifiCfg.ssid}</div>
                  <div style={{fontSize:10,color:"#475569"}}>🔒{wifiCfg.security}</div>
                </div>
              </div>
            </>}
          </div>

          {/* TIMEZONE */}
          <div style={S.spoofCard}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={S.spoofTitle}>🕐 TIMEZONE SPOOF</div>
              <Toggle on={tzCfg.enabled} onChange={v=>setTzCfg({...tzCfg,enabled:v})}/>
            </div>
            {tzCfg.enabled&&<>
              <select style={S.miniSel} value={tzCfg.tz} onChange={e=>setTzCfg({...tzCfg,tz:e.target.value})}>
                {TIMEZONES.map(t=><option key={t.tz} value={t.tz}>{t.label}</option>)}
              </select>
              <div style={{background:"#080d17",borderRadius:8,padding:"10px 14px",border:"1px solid #1e3a5f",textAlign:"center"}}>
                <div style={{fontSize:10,color:"#475569",marginBottom:4}}>SPOOFED TIME</div>
                <div style={{fontSize:24,color:"#5eead4",fontFamily:"monospace",fontWeight:700}}>{tzDisplay}</div>
                <div style={{fontSize:11,color:"#475569"}}>{tzCfg.tz}</div>
              </div>
            </>}
          </div>

          {/* ALTITUDE */}
          <div style={S.spoofCard}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={S.spoofTitle}>⛰ ALTITUDE SPOOF</div>
              <Toggle on={altCfg.enabled} onChange={v=>setAltCfg({...altCfg,enabled:v})}/>
            </div>
            {altCfg.enabled&&<>
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:8,alignItems:"end"}}>
                <div>
                  <label style={S.miniLabel}>Elevation Value</label>
                  <input type="range" min="-100" max="8849" value={altCfg.value} onChange={e=>setAltCfg({...altCfg,value:Number(e.target.value)})} style={{width:"100%",accentColor:"#a78bfa"}}/>
                  <div style={{textAlign:"center",color:"#a78bfa",fontSize:13,fontFamily:"monospace",fontWeight:700}}>{altCfg.value} {altCfg.unit}</div>
                </div>
                <div>
                  <label style={S.miniLabel}>Unit</label>
                  <select style={S.miniSel} value={altCfg.unit} onChange={e=>setAltCfg({...altCfg,unit:e.target.value})}>
                    <option value="m">Meters</option><option value="ft">Feet</option>
                  </select>
                </div>
              </div>
              <input style={S.miniInput} type="number" placeholder="Or type exact value" value={altCfg.value} onChange={e=>setAltCfg({...altCfg,value:Number(e.target.value)})}/>
              <div style={{background:"#080d17",borderRadius:8,padding:"8px 12px",border:"1px solid #1e3a5f",fontSize:11,color:"#94a3b8"}}>
                Preset: <button style={S.presetBtn} onClick={()=>setAltCfg({...altCfg,value:0})}>Sea Level</button>
                <button style={S.presetBtn} onClick={()=>setAltCfg({...altCfg,value:altCfg.unit==="m"?300:984})}>300m Hill</button>
                <button style={S.presetBtn} onClick={()=>setAltCfg({...altCfg,value:altCfg.unit==="m"?1500:4921})}>1500m Mtn</button>
              </div>
            </>}
          </div>

          {/* MOTION */}
          <div style={S.spoofCard}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={S.spoofTitle}>📱 MOTION SPOOF</div>
              <Toggle on={motionCfg.motionSpoof} onChange={v=>setMotionCfg({...motionCfg,motionSpoof:v})}/>
            </div>
            {motionCfg.motionSpoof&&<>
              <div style={{background:"#080d17",borderRadius:8,padding:"10px 14px",border:"1px solid #1e3a5f",fontFamily:"monospace"}}>
                <div style={{fontSize:10,color:"#475569",letterSpacing:2,marginBottom:6}}>LIVE ACCELEROMETER OUTPUT</div>
                {[["X",motionData.x,"#f87171"],["Y",motionData.y,"#4ade80"],["Z",motionData.z,"#38bdf8"]].map(([ax,val,col])=>(
                  <div key={ax} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <span style={{color:col,fontSize:12,width:16}}>{ax}</span>
                    <div style={{flex:1,height:6,background:"#1e293b",borderRadius:3,overflow:"hidden"}}>
                      <div style={{width:`${Math.min(Math.abs(val)/20*100,100)}%`,height:"100%",background:col,transition:"width .1s"}}/>
                    </div>
                    <span style={{color:col,fontSize:11,width:48,textAlign:"right"}}>{val.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div style={S.hint}>Motion data mirrors the activity type currently being replayed — walking produces natural step patterns, driving produces smooth low-frequency data.</div>
            </>}
          </div>

          <button style={{...S.btn,background:"#1e293b",color:"#5eead4",marginTop:4}} onClick={()=>{
            const blob=new Blob([JSON.stringify({battery:battCfg,wifi:wifiCfg,timezone:tzCfg,altitude:altCfg},null,2)],{type:"application/json"});
            const url=URL.createObjectURL(blob),a=document.createElement("a");
            a.href=url;a.download="spoof360_config.json";a.click();
          }}>⬇ EXPORT ALL SPOOF CONFIG</button>
        </div>}

        {/* ══ TOOLS ══ */}
        {tab==="tools"&&<div style={S.panel}>

          {/* TELEPORT */}
          <div style={S.spoofCard}>
            <div style={S.spoofTitle}>🌐 QUICK TELEPORT</div>
            <div style={{fontSize:12,color:"#475569",marginBottom:10,lineHeight:1.5}}>Type any address or place name to instantly get its coordinates for spoofing.</div>
            <input style={S.input} placeholder="e.g. Eiffel Tower, Paris" value={teleportAddr} onChange={e=>setTeleportAddr(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&doTeleport()}/>
            <button style={{...S.btn,...S.btnBlue}} onClick={doTeleport} disabled={teleportLoading}>
              {teleportLoading?"⏳ Searching...":"🔍 FIND & TELEPORT"}
            </button>
            {teleportResult&&<div style={{background:"#080d17",border:`1px solid ${teleportResult.error?"#f8717133":"#4ade8033"}`,borderRadius:8,padding:"12px",marginTop:4}}>
              {teleportResult.error?<div style={{color:"#f87171",fontSize:13}}>{teleportResult.error}</div>:<>
                <div style={{fontSize:10,color:"#475569",letterSpacing:2,marginBottom:6}}>TELEPORT TARGET</div>
                <div style={{fontSize:11,color:"#94a3b8",marginBottom:8,lineHeight:1.5}}>{teleportResult.name}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div style={{background:"#0d1b2a",borderRadius:6,padding:8,textAlign:"center"}}>
                    <div style={{fontSize:10,color:"#475569"}}>LATITUDE</div>
                    <div style={{fontSize:14,color:"#5eead4",fontFamily:"monospace",fontWeight:700}}>{teleportResult.lat.toFixed(6)}</div>
                  </div>
                  <div style={{background:"#0d1b2a",borderRadius:6,padding:8,textAlign:"center"}}>
                    <div style={{fontSize:10,color:"#475569"}}>LONGITUDE</div>
                    <div style={{fontSize:14,color:"#5eead4",fontFamily:"monospace",fontWeight:700}}>{teleportResult.lng.toFixed(6)}</div>
                  </div>
                </div>
                <button style={{...S.btn,...S.btnGreen,marginTop:10,marginBottom:0,padding:"10px"}} onClick={()=>{
                  // Save as a single-point "location" trip
                  const pt={lat:teleportResult.lat,lng:teleportResult.lng,alt:altCfg.enabled?altCfg.value:0,spd:0,ts:0};
                  const trip={id:Date.now(),name:`📍 ${teleportResult.name.split(",")[0]}`,notes:`Teleport to: ${teleportResult.name}`,points:[pt,pt],savedAt:Date.now(),stats:tripStats([pt,pt])};
                  const u=[trip,...trips];setTrips(u);sv(SK.trips,u);
                  alert("Saved as a trip! Use in Schedule → Stationary block to hold at this location.");
                }}>📌 SAVE AS LOCATION PIN</button>
              </>}
            </div>}
          </div>

          {/* GEOFENCE */}
          <div style={S.spoofCard}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={S.spoofTitle}>📍 GEOFENCE TRIGGERS</div>
              <button style={{...S.iconBtn,fontSize:11}} onClick={()=>setAddingGeo(!addingGeo)}>{addingGeo?"✕ Cancel":"＋ Add"}</button>
            </div>
            <div style={{fontSize:12,color:"#475569",marginBottom:10,lineHeight:1.5}}>Automatically start a trip when you enter or leave a defined zone.</div>
            {addingGeo&&<div style={{background:"#080d17",border:"1px solid #1e3a5f",borderRadius:10,padding:"12px",marginBottom:12}}>
              <label style={S.miniLabel}>Zone Name</label>
              <input style={S.input} placeholder="e.g. Home Zone" value={newGeo.name} onChange={e=>setNewGeo({...newGeo,name:e.target.value})}/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div><label style={S.miniLabel}>Latitude</label><input style={S.miniInput} type="number" step="0.000001" value={newGeo.lat} onChange={e=>setNewGeo({...newGeo,lat:e.target.value})}/></div>
                <div><label style={S.miniLabel}>Longitude</label><input style={S.miniInput} type="number" step="0.000001" value={newGeo.lng} onChange={e=>setNewGeo({...newGeo,lng:e.target.value})}/></div>
              </div>
              <label style={S.miniLabel}>Radius: {newGeo.radius}m</label>
              <input type="range" min="50" max="5000" step="50" value={newGeo.radius} onChange={e=>setNewGeo({...newGeo,radius:Number(e.target.value)})} style={{width:"100%",accentColor:"#f97316",marginBottom:8}}/>
              <label style={S.miniLabel}>Trigger</label>
              <select style={S.miniSel} value={newGeo.trigger} onChange={e=>setNewGeo({...newGeo,trigger:e.target.value})}>
                <option value="enter">When I ENTER this zone</option>
                <option value="exit">When I LEAVE this zone</option>
              </select>
              <label style={S.miniLabel}>Auto-start Trip</label>
              <select style={S.miniSel} value={newGeo.tripId||""} onChange={e=>setNewGeo({...newGeo,tripId:Number(e.target.value)||null})}>
                <option value="">— select trip —</option>
                {trips.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button style={{...S.btn,...S.btnGreen,marginBottom:0}} onClick={()=>{
                if(!newGeo.name||!newGeo.lat||!newGeo.lng)return;
                const u=[...geofences,{...newGeo,id:Date.now(),active:true}];
                setGeofences(u);setAddingGeo(false);setNewGeo({name:"",lat:"",lng:"",radius:200,trigger:"enter",tripId:null});
              }}>💾 SAVE GEOFENCE</button>
            </div>}
            {geofences.length===0&&!addingGeo&&<div style={S.empty}>No geofences set up yet.</div>}
            {geofences.map(g=><div key={g.id} style={{background:"#0d1b2a",border:"1px solid #f9731633",borderRadius:8,padding:"10px 12px",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#f97316"}}>{g.name}</div>
                  <div style={{fontSize:11,color:"#475569"}}>{g.trigger==="enter"?"Enter":"Exit"} zone · r={g.radius}m</div>
                  <div style={{fontSize:10,color:"#334155"}}>{Number(g.lat).toFixed(4)}, {Number(g.lng).toFixed(4)}</div>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <Toggle on={g.active} onChange={v=>{const u=geofences.map(x=>x.id===g.id?{...x,active:v}:x);setGeofences(u);}}/>
                  <button style={{...S.iconBtn,color:"#f87171"}} onClick={()=>setGeofences(geofences.filter(x=>x.id!==g.id))}>✕</button>
                </div>
              </div>
            </div>)}
          </div>

          {/* CHANGE PIN */}
          <div style={S.spoofCard}>
            <div style={S.spoofTitle}>🔐 CHANGE PIN</div>
            <button style={{...S.btn,background:"#1e293b",color:"#5eead4",marginTop:8}} onClick={()=>{sv(SK.pin,"");setUnlocked(false);window.location.reload();}}>
              Reset PIN (will ask on next open)
            </button>
          </div>

        </div>}

        {/* ══ TRIPS ══ */}
        {tab==="trips"&&<div style={S.panel}>
          <label style={{...S.btn,...S.btnGreen,textAlign:"center",cursor:"pointer",display:"block"}}>
            📂 IMPORT TRIP JSON
            <input type="file" accept=".json" onChange={e=>{
              const file=e.target.files?.[0];if(!file)return;
              const r=new FileReader();
              r.onload=ev=>{try{const t=JSON.parse(ev.target.result);if(!t.points)throw 0;t.id=Date.now();t.points=enrichSpeeds(t.points);if(!t.stats)t.stats=tripStats(t.points);const u=[t,...trips];setTrips(u);sv(SK.trips,u);}catch{alert("Invalid file.");}};
              r.readAsText(file);
            }} style={{display:"none"}}/>
          </label>
          <div style={{height:12}}/>
          {trips.length===0&&<div style={S.empty}>No trips yet.</div>}
          {trips.map(t=>{
            const act=getActivity(t.stats?.avgKph??null);
            return<div key={t.id} style={{...S.tripCard,borderColor:act.color+"44"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{fontSize:24}}>{act.icon}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:700,color:"#e2e8f0",fontFamily:"monospace"}}>{t.name}</div>
                  <div style={{fontSize:11,color:act.color}}>{act.label}</div>
                </div>
              </div>
              {t.notes&&<div style={{background:"#080d17",borderRadius:6,padding:"6px 10px",marginBottom:8,fontSize:11,color:"#94a3b8",lineHeight:1.5}}>📝 {t.notes}</div>}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
                <MS label="Avg Spd" val={`${t.stats?.avgKph?.toFixed(1)||"—"} kph`}/>
                <MS label="Max Spd" val={`${t.stats?.maxKph?.toFixed(1)||"—"} kph`}/>
                <MS label="Dist" val={`${((t.stats?.dist||0)/1000).toFixed(2)}km`}/>
              </div>
              <ActivityBar pts={t.points}/>
              <div style={{fontSize:10,color:"#334155",marginBottom:8}}>{new Date(t.savedAt).toLocaleString()}</div>
              <div style={{display:"flex",gap:8}}>
                <button style={{...S.btn,...S.btnBlue,padding:"8px",fontSize:12,marginBottom:0,flex:2}} onClick={()=>{setSelectedTrip(t);setReplayIdx(0);setReplayPos(t.points[0]);setReplayElapsed(0);setTab("replay");}}>▶ Replay</button>
                <button style={{...S.btn,background:"#1e293b",color:"#94a3b8",padding:"8px",fontSize:12,marginBottom:0,flex:1}} onClick={()=>{const blob=new Blob([JSON.stringify(t,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`${t.name.replace(/\s+/g,"_")}.json`;a.click();}}>⬇</button>
                <button style={{...S.btn,...S.btnDiscard,padding:"8px",fontSize:12,marginBottom:0,flex:1}} onClick={()=>{const u=trips.filter(x=>x.id!==t.id);setTrips(u);sv(SK.trips,u);}}>🗑</button>
              </div>
            </div>;
          })}
        </div>}

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  SMALL REUSABLE COMPONENTS
// ═══════════════════════════════════════════════════════
function Sq({label,value}) {
  return<div style={S.sq}><div style={S.sqL}>{label}</div><div style={S.sqV}>{value}</div></div>;
}
function CR({label,val,hi}) {
  return<div style={S.coordRow}><span style={S.coordLabel}>{label}</span><span style={{...S.coordVal,color:hi?"#fbbf24":"#5eead4"}}>{val}</span></div>;
}
function MS({label,val}) {
  return<div style={{background:"#0a1220",borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:9,color:"#475569",letterSpacing:1}}>{label}</div><div style={{fontSize:12,color:"#5eead4",fontWeight:700,marginTop:2,fontFamily:"monospace"}}>{val}</div></div>;
}
function Toggle({on,onChange}) {
  return<div onClick={()=>onChange(!on)} style={{width:40,height:22,borderRadius:11,background:on?"#4ade8066":"#1e293b",border:`1.5px solid ${on?"#4ade80":"#334155"}`,position:"relative",cursor:"pointer",transition:"all .2s"}}>
    <div style={{position:"absolute",top:2,left:on?18:2,width:16,height:16,borderRadius:"50%",background:on?"#4ade80":"#475569",transition:"left .2s"}}/>
  </div>;
}

// ═══════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════
const S={
  root:{minHeight:"100vh",background:"#0a0e1a",color:"#e2e8f0",fontFamily:"'Courier New',monospace",display:"flex",flexDirection:"column",position:"relative"},
  header:{background:"linear-gradient(135deg,#0d1b2a,#0f2744)",padding:"18px 16px 12px",borderBottom:"2px solid #1e3a5f",position:"relative"},
  logo:{fontSize:26,fontWeight:700,color:"#5eead4",letterSpacing:3},
  subtitle:{fontSize:10,color:"#334155",letterSpacing:4,marginTop:2},
  tabs:{display:"flex",background:"#080d17",borderBottom:"1px solid #1e3a5f",overflowX:"auto"},
  tab:{flex:1,padding:"12px 4px",background:"transparent",border:"none",color:"#475569",cursor:"pointer",fontSize:14,fontFamily:"monospace",whiteSpace:"nowrap",letterSpacing:1},
  tabOn:{color:"#5eead4",borderBottom:"2px solid #5eead4",background:"#0a1628"},
  content:{flex:1,overflowY:"auto"},
  panel:{padding:"16px"},
  grid2:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14},
  sq:{background:"#0d1b2a",border:"1px solid #1e3a5f",borderRadius:8,padding:"10px 12px"},
  sqL:{fontSize:10,color:"#475569",letterSpacing:2,textTransform:"uppercase"},
  sqV:{fontSize:16,fontWeight:700,color:"#5eead4",marginTop:4,fontFamily:"monospace"},
  coordBox:{background:"#080d17",border:"1px solid #5eead433",borderRadius:8,padding:"12px 14px",marginBottom:14},
  coordRow:{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #0d1b2a"},
  coordLabel:{color:"#475569",fontSize:11,letterSpacing:2},
  coordVal:{fontSize:13,fontWeight:700,fontFamily:"monospace"},
  btn:{width:"100%",padding:"14px",borderRadius:10,border:"none",cursor:"pointer",fontFamily:"monospace",fontSize:13,fontWeight:700,letterSpacing:2,marginBottom:10,textTransform:"uppercase"},
  btnBlue:{background:"linear-gradient(135deg,#38bdf8,#0369a1)",color:"#000"},
  btnRed:{background:"linear-gradient(135deg,#f87171,#dc2626)",color:"#fff"},
  btnGreen:{background:"linear-gradient(135deg,#4ade80,#16a34a)",color:"#000"},
  btnDiscard:{background:"#1a0a0a",color:"#f87171",border:"1px solid #f8717122"},
  input:{width:"100%",background:"#0d1b2a",border:"1px solid #1e3a5f",borderRadius:8,padding:"12px",color:"#e2e8f0",fontFamily:"monospace",fontSize:13,marginBottom:10,boxSizing:"border-box"},
  miniLabel:{display:"block",fontSize:10,color:"#475569",letterSpacing:2,textTransform:"uppercase",marginBottom:4},
  miniSel:{width:"100%",background:"#0d1b2a",border:"1px solid #1e3a5f",borderRadius:6,padding:"9px",color:"#e2e8f0",fontFamily:"monospace",fontSize:12,marginBottom:10},
  miniInput:{width:"100%",background:"#0d1b2a",border:"1px solid #1e3a5f",borderRadius:6,padding:"8px",color:"#e2e8f0",fontFamily:"monospace",fontSize:12,marginBottom:8,boxSizing:"border-box"},
  timeInput:{width:"100%",background:"#0d1b2a",border:"1px solid #1e3a5f",borderRadius:6,padding:"10px",color:"#5eead4",fontFamily:"monospace",fontSize:14,marginBottom:10,boxSizing:"border-box"},
  err:{background:"#1a0a0a",border:"1px solid #f87171",borderRadius:8,padding:"10px 12px",color:"#f87171",marginBottom:12,fontSize:12},
  empty:{textAlign:"center",color:"#334155",padding:"40px 0",fontSize:13},
  hint:{background:"#0a1628",border:"1px solid #1e3a5f",borderRadius:8,padding:"10px 12px",color:"#475569",fontSize:11,lineHeight:1.7,marginTop:8},
  banner:{textAlign:"center",padding:"10px",borderRadius:8,border:"1px solid",fontWeight:700,fontSize:14,letterSpacing:2,marginBottom:12,textTransform:"uppercase"},
  spoofCard:{background:"#0d1b2a",border:"1px solid #1e3a5f",borderRadius:12,padding:"14px",marginBottom:14},
  spoofTitle:{fontSize:12,fontWeight:700,color:"#5eead4",letterSpacing:2},
  tripCard:{background:"#0d1b2a",border:"1px solid",borderRadius:10,padding:"12px",marginBottom:12},
  progBar:{height:5,background:"#0d1b2a",borderRadius:3,overflow:"hidden",border:"1px solid #1e3a5f"},
  progFill:{height:"100%",background:"linear-gradient(90deg,#5eead4,#4ade80)",transition:"width 0.3s"},
  iconBtn:{background:"#0d1b2a",border:"1px solid #1e3a5f",color:"#7ec8e3",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:12,fontFamily:"monospace"},
  presetBtn:{background:"#1e293b",border:"none",color:"#94a3b8",borderRadius:4,padding:"3px 8px",cursor:"pointer",fontSize:10,marginRight:6,fontFamily:"monospace"},
};
