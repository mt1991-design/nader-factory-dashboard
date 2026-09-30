/* ================= Nader Workroom layer =================
   Adds to the live dashboard: KPI strip, filter-chip counts, status stripes, ⌘K palette, keyboard shortcuts,
   production board (Mark done + stamp + confetti), Today timeline, crew Undo + spring, crew profile cards,
   workshop mode, podium leaderboard, order drawer with stage history, loading shimmer.
   Loaded after the main script; it wraps the existing functions rather than replacing their logic. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const RM=matchMedia("(prefers-reduced-motion: reduce)").matches;
const STG=PROD_STAGES;                         /* Drawing, Carpentry, Foaming, Fabrication, Packing */
const LATE=[3,6,3,6,2,7];                      /* days in a stage before the badge turns amber */
const ROLE_NAME={0:"Drawer",1:"Carpenter",2:"Foamer",3:"Fabricator",4:"Packer"};
const COLORS=["#8A4B2A","#5F6B3A","#3F5E73","#6B1A22","#7A5A9A","#2E6A5E","#94702F","#9A4C62","#4F5D8A","#6E6259"];
const colorOf=n=>COLORS[drawHash(String(n).toLowerCase())%COLORS.length];
const initials=n=>String(n||"?").trim().split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase();
const uaeISO=()=>new Date(Date.now()+4*3600e3).toISOString().slice(0,16);   /* staff are in the UAE (UTC+4) */
const uaeDay=()=>uaeISO().slice(0,10);
const pdMs=s=>Date.parse(String(s).length>10?s+":00+04:00":s+"T00:00:00+04:00");
const daysSince=s=>Math.max(0,Math.floor((Date.now()-pdMs(s))/864e5));
const store={get(k,d){try{const v=localStorage.getItem("wr_"+k);return v==null?d:v;}catch(e){return d;}},set(k,v){try{localStorage.setItem("wr_"+k,v);}catch(e){}}};
const onStaff=()=>USER&&["screen-sales","screen-factory","screen-admin"].some(id=>$(id)&&!$(id).hidden);
const curScreen=()=>["screen-sales","screen-factory","screen-admin"].find(id=>$(id)&&!$(id).hidden)||"";
const byId=id=>SHOPIFY.find(x=>String(x.id)===String(id));

/* ---------- one line of production: order + item + where it is ---------- */
function lineInfo(o,i){
  const cur=(o.prod_stages||[])[i]||0, pd=((o.prod_dates||{})[i])||{};
  let since=pd[cur]; if(!since){for(let s=cur-1;s>0&&!since;s--)since=pd[s];} if(!since)since=o.date;
  return {o,i,it:o.items[i],cur,since,days:since?daysSince(since):0,crew:((o.crew||{})[i])||{},pd};
}
function openLines(factoryOnly){
  const out=[];
  SHOPIFY.filter(o=>!o.isDraft&&o.state==="open").forEach(o=>o.items.forEach((it,i)=>{
    if(!isFurnitureLine(it.product))return;
    const L=lineInfo(o,i);
    if(factoryOnly&&!lineDrawn(o,i))return;
    out.push(L);
  }));
  return out;
}

/* ================= top bars: official logo, ⌘K, workshop, avatar ================= */
function setupBars(){
  ["screen-sales","screen-factory","screen-admin"].forEach(id=>{
    const sc=$(id); if(!sc)return; sc.classList.add("wrs");
    const bar=sc.querySelector(".topbar"); if(!bar||bar.classList.contains("wr-bar"))return;
    bar.classList.add("wr-bar");
    const img=bar.querySelector(".worklogo"); if(img){img.dataset.cream="1";img.alt="Nader";}
    const sp=bar.querySelector(".topspacer");
    const sb=document.createElement("button"); sb.type="button"; sb.className="wr-search"; sb.setAttribute("aria-label","Search orders");
    sb.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="wr-lbl">Jump to an order…</span><span class="wr-kbd">⌘K</span>';
    sb.onclick=openPal; sp.after(sb);
    if(id!=="screen-admin"){
      const wb=document.createElement("button"); wb.type="button"; wb.className="wr-ib wr-wsbtn"; wb.title="Tablet mode (T): bigger buttons and text for the tablet on the factory floor";
      wb.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/></svg><span class="wr-lbl">Tablet mode</span>';
      wb.onclick=()=>setWorkshop(!document.body.classList.contains("wr-workshop"));
      bar.querySelector(".roleswitch").before(wb);
    }
    const av=document.createElement("div"); av.className="wr-avatar"; av.id="wrAv-"+id; bar.appendChild(av);
  });
  /* New order / New drawing: gold buttons in the Sales bar */
  const sbar=document.querySelector("#screen-sales .topbar");
  if(sbar){const a=sbar.querySelector('a[onclick*="openSalesForm"]'),d=sbar.querySelector('button[onclick="newDrawing()"]');
    if(a){a.removeAttribute("style");a.className="wr-new";a.innerHTML="＋ New order";a.title="New order (N)";}
    if(d){d.removeAttribute("style");d.className="wr-new wr-newd";d.innerHTML="✎ New drawing";d.title="New drawing without a sales form (D)";}}
  const cream=window.LOGO_CREAM; if(cream)document.querySelectorAll('.wr-bar img[data-cream]').forEach(im=>im.src=cream);
}
function paintAvatar(){ if(!USER)return; paintGreet(); ["screen-sales","screen-factory","screen-admin"].forEach(id=>{const a=$("wrAv-"+id);if(a){a.textContent=initials(USER.name||USER.username);a.title="Signed in as "+(USER.name||USER.username);}}); }

/* ================= greeting: Good morning / afternoon / evening, <first name> ================= */
function greetHTML(sub){
  const h=new Date(Date.now()+4*3600e3).getUTCHours();   /* UAE time */
  const part=h<12?"Good morning":h<17?"Good afternoon":"Good evening";
  const first=String((USER&&(USER.name||USER.username))||"").trim().split(/\s+/)[0];
  const day=new Date(Date.now()+4*3600e3).toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"});
  return `<h2>${esc(part)}${first?", "+esc(first):""}</h2><p>${esc(day)}${sub?" · "+esc(sub):""}</p>`;
}
function paintGreet(){
  if(!USER)return;
  const open=SHOPIFY.filter(o=>!o.isDraft&&o.state==="open").length, t=drawingTally(), left=t.all-t.done;
  const lines=SHOPIFY.length?openLines(true).length:0;
  const subs={"screen-sales":SHOPIFY.length?`${open} open order${open===1?"":"s"}, ${left} still to draw`:"",
    "screen-factory":SHOPIFY.length?`${lines} piece${lines===1?"":"s"} on the floor`:"","screen-admin":"Team activity"};
  Object.keys(subs).forEach(id=>{const sc=$(id);if(!sc)return;let g=sc.querySelector(".wr-greet");
    if(!g){g=document.createElement("div");g.className="wr-greet";sc.querySelector(".topbar").after(g);}
    g.innerHTML=greetHTML(subs[id]);});
}

/* ================= workshop mode ================= */
function setWorkshop(on,silent,noSave){
  document.body.classList.toggle("wr-workshop",on);
  document.querySelectorAll(".wr-wsbtn").forEach(b=>b.setAttribute("aria-pressed",String(on)));
  if(!noSave)store.set("workshop",on?"1":"0");

}

/* ================= KPI strip (Sales) ================= */
let kpiCounted=false;
function spark(arr){ if(!arr||!arr.length)return"";
  const w=120,h=36,mx=Math.max(1,...arr),st=w/(arr.length-1);
  const pts=arr.map((v,i)=>[i*st,h-3-(v/mx)*(h-8)]);
  const d=pts.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" ");
  const e=pts[pts.length-1];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-label="Orders per week, last 12 weeks" role="img"><path d="${d} L${w} ${h} L0 ${h}Z" fill="var(--w-accent-soft)"/><path d="${d}" fill="none" stroke="var(--w-accent)" stroke-width="1.8" stroke-linejoin="round"/><circle cx="${e[0]}" cy="${e[1]}" r="3" fill="var(--w-accent)"/></svg>`;
}
function renderKpis(){
  const box=$("wrKpis"); if(!box)return;
  const loading=!SHOPIFY.length;
  const open=SHOPIFY.filter(o=>!o.isDraft&&o.state==="open").length;
  const wk=window.WEEKLY||null, thisWeek=wk?wk[wk.length-1]:null;
  const t=drawingTally(), pct=t.all?t.done/t.all:0, C=2*Math.PI*26;
  const lines=openLines(false), per=STG.map(()=>0); lines.forEach(L=>per[L.cur]++); const mx=Math.max(1,...per);
  const lead=window.LEAD;
  const leadHTML=lead&&lead.ready
    ?`<div class="big" data-n="${lead.avg}">${lead.avg}<small>days</small></div><div class="note">Order placed → packed · from ${lead.n} pieces</div>`
    :`<div class="big blank">—</div><div class="note">Collecting data. Starts once the team has updated stages for 3 weeks${lead&&lead.n?` (${lead.n} of 5 pieces timed so far)`:""}.</div>`;
  box.innerHTML=`<div class="wr-kpis">
    <div class="wr-kpi"><div class="lbl">Open orders</div><div class="row"><div class="big" data-n="${open}">${loading?"—":open}</div>${spark(wk)}</div><div class="note">${thisWeek!=null?`<span class="delta">+${thisWeek}</span> placed this week`:"Last 12 weeks"}</div></div>
    <div class="wr-kpi"><div class="lbl">Drawings complete</div><div class="wr-gauge"><svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" fill="none" stroke="var(--w-line)" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="var(--w-ok)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(C*pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 32 32)"/><text x="32" y="36" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="12" font-weight="600" fill="var(--w-ink)">${Math.round(pct*100)}%</text></svg><div><div class="big"><span data-n="${t.done}">${loading?"—":t.done}</span><small>of ${t.all}</small></div><div class="note">${t.all-t.done} still to draw</div></div></div></div>
    <div class="wr-kpi"><div class="lbl">Pieces in each stage</div><div class="wr-sc">${STG.map((s,i)=>`<div><span class="v" data-n="${per[i]}">${loading?"—":per[i]}</span><span class="bar"><i style="width:${loading?0:Math.round(per[i]/mx*100)}%"></i></span><span class="t" title="${s}">${s}</span></div>`).join("")}</div></div>
    <div class="wr-kpi"><div class="lbl">Avg lead time</div>${leadHTML}</div></div>`;
  if(!loading&&!kpiCounted&&!RM){kpiCounted=true;box.querySelectorAll("[data-n]").forEach(el=>{const n=+el.dataset.n,first=el.firstChild;if(!first||first.nodeType!==3)return;const t0=performance.now();
    (function step(t){const k=Math.min(1,(t-t0)/700),v=Math.round(n*(1-Math.pow(1-k,3)));first.nodeValue=String(v);if(k<1)requestAnimationFrame(step);})(t0);});}
}

/* ================= filter chips with live counts ================= */
const _buildFilters=buildFilters;
buildFilters=function(){ _buildFilters.apply(this,arguments);
  const box=$("salesstatuschips"); if(!box)return;
  const base=SHOPIFY.filter(o=>salesView==="drafts"?o.isDraft:!o.isDraft).filter(o=>salesMonth==="all"||(o.date||"").slice(0,7)===salesMonth);
  box.querySelectorAll(".fchip").forEach(b=>{const m=(b.getAttribute("onclick")||"").match(/toggleStatus\('([^']+)'\)/);if(!m)return;const k=m[1];
    b.setAttribute("aria-pressed",String(salesStatuses.has(k)));
    if(k==="drawn"){const t=drawingTally();b.innerHTML=`Drawing complete <span class="wr-mini"><i style="width:${t.all?Math.round(t.done/t.all*100):0}%"></i></span><span class="wr-c">${t.done}/${t.all}</span>`;}
    else{const n=base.filter(o=>matchOne(o,k)).length;b.insertAdjacentHTML("beforeend",` <span class="wr-c">${n}</span>`);}
  });
};

/* ================= status stripe + clearer pills (orders list) ================= */
function stripeFor(o){
  if(o.isDraft)return"var(--w-gold)";
  if(o.state==="shipped")return"var(--w-line2)";
  if(o.items.some((it,i)=>lineCheck(o,i)))return"var(--w-bad)";
  if(needsDrawing(o))return"var(--w-warn)";
  if((o.prod_stage||0)>=1||(o.prod_stages||[]).some(s=>s>=1))return"var(--w-accent)";
  return"var(--w-ok)";
}
function decorateRows(){
  const tb=$("salesrows"); if(!tb)return; const seen=new Set();
  tb.querySelectorAll("tr[data-oi]").forEach(tr=>{const o=SHOPIFY[+tr.dataset.oi];if(!o)return;
    tr.classList.add("wr-row"); tr.style.setProperty("--stripe",stripeFor(o));
    if(seen.has(o))return; seen.add(o);
    const p=tr.querySelector(".pill.sent"); if(!p||o.isDraft||o.state!=="open"||salesView==="production")return;
    const st=Math.max(...(o.prod_stages&&o.prod_stages.length?o.prod_stages:[0]));
    if(o.items.some((it,i)=>lineCheck(o,i))){p.textContent="Check dimensions";p.classList.add("wr-pill-wait");}
    else if(needsDrawing(o)){p.textContent="Awaiting drawing";p.classList.add("wr-pill-wait");}
    else if(st===5){const w=Object.values(o.delivery||{})[0];p.textContent=w?"Delivery "+fmtDelivery(w):"Delivery booked";p.classList.add("wr-pill-ready");}
    else if(st>=1){p.textContent="In "+STG[st].toLowerCase();p.classList.add("wr-pill-prod");}
    else{p.textContent="Ready for carpentry";p.classList.add("wr-pill-ready");}
  });
}

/* ================= loading shimmer ================= */
let LOADING=false;
function skeleton(tb,cols){ if(!tb)return; tb.innerHTML=Array.from({length:6},(_,r)=>'<tr class="wr-skel">'+Array.from({length:cols},(_,c)=>`<td><i style="width:${[70,85,60,50,65,40][(r+c)%6]}%"></i></td>`).join("")+"</tr>").join(""); }
const _loadShopify=loadShopify;
loadShopify=function(){ LOADING=true; if(!SHOPIFY.length){ if(!$("screen-sales").hidden)skeleton($("salesrows"),6); if(!$("screen-factory").hidden)skeleton($("orderrows"),4); }
  return _loadShopify.apply(this,arguments).finally(()=>{LOADING=false;}); };

/* keep stage dates in step locally so days-in-stage and Today update straight away */
const _setStage=setProdStageServer;
setProdStageServer=function(id,line,idx){ const o=byId(id);
  if(o){o.prod_dates=o.prod_dates||{};const P=o.prod_dates[line]=o.prod_dates[line]||{};Object.keys(P).forEach(k=>{if(+k>idx)delete P[k];});if(idx>0&&!P[idx])P[idx]=uaeISO();}
  const was=o&&o.prod_stages?(o.prod_stages[line]||0):0;
  if(idx===4&&was<4)setTimeout(confetti,300);   /* a piece reaching Packing gets a little gold burst */
  return _setStage(id,line,idx); };

/* ================= Today on the floor ================= */
function todayEvents(){
  const day=uaeDay(),ev=[];
  SHOPIFY.forEach(o=>{ if(o.isDraft)return;
    Object.keys(o.prod_dates||{}).forEach(line=>{const P=o.prod_dates[line];Object.keys(P).forEach(s=>{if(String(P[s]).slice(0,10)!==day)return;
      const it=o.items[line]||{};ev.push({t:P[s].slice(11,16),id:o.id,x:`${o.order} ${drawBase(it.product)||it.product||""} moved to ${STG[s]}`});});});
    Object.keys(o.crew||{}).forEach(line=>{Object.keys(o.crew[line]).forEach(s=>{crewList(o,line,s).forEach(a=>{if(a.d!==day)return;
      const it=o.items[line]||{};ev.push({t:"",id:o.id,x:`${a.n} on ${STG[s].toLowerCase()} · ${o.order} ${drawBase(it.product)||it.product||""}`});});});});
  });
  return ev.sort((a,b)=>(a.t||"99").localeCompare(b.t||"99"));
}
function renderToday(box){
  if(!box)return; const ev=todayEvents();
  const now=uaeISO().slice(11,16), toMin=t=>+t.slice(0,2)*60+ +t.slice(3,5), S=8*60, E=18*60;
  const pos=t=>Math.max(0,Math.min(100,(toMin(t)-S)/(E-S)*100));
  const timed=ev.filter(e=>e.t), nowP=pos(now);
  const d=new Date(Date.now()+4*3600e3), lbl=d.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"});
  box.innerHTML=`<div class="wr-today"><h3>Today · ${lbl} <span>Workshop hours 08:00–18:00</span></h3>
    <div class="wr-tl"><div class="axis"></div><div class="past" style="width:${nowP}%"></div>
      ${[8,10,12,14,16,18].map(h=>`<span class="tick" style="left:${(h*60-S)/(E-S)*100}%">${String(h).padStart(2,"0")}:00</span>`).join("")}
      ${timed.map((e,k)=>`<button type="button" class="ev" style="left:${pos(e.t)}%" data-k="${k}" title="${e.t} ${esc(e.x)}" aria-label="${e.t} ${esc(e.x)}"></button>`).join("")}
      ${toMin(now)>=S&&toMin(now)<=E?`<div class="now" style="left:${nowP}%"></div>`:""}</div>
    ${ev.length?`<div class="wr-evs">${ev.map((e,k)=>`<div class="wr-evc" data-ev="${esc(String(e.id))}" data-k="${e.t?timed.indexOf(e):-1}"><span class="tm">${e.t||"Today"}</span>${esc(e.x)}</div>`).join("")}</div>`
      :'<div class="wr-empty">Nothing logged on the floor yet today. Stage moves and names show here as the team updates the board.</div>'}</div>`;
  box.querySelectorAll(".wr-tl .ev").forEach(b=>{const hl=on=>{b.classList.toggle("hl",on);const c=box.querySelector(`.wr-evc[data-k="${b.dataset.k}"]`);if(c){c.classList.toggle("hl",on);if(on)c.scrollIntoView({block:"nearest",inline:"nearest",behavior:RM?"auto":"smooth"});}};
    b.onmouseenter=()=>hl(true);b.onmouseleave=()=>hl(false);b.onclick=()=>{const c=box.querySelector(`.wr-evc[data-k="${b.dataset.k}"]`);if(c)c.click();};});
}

/* ================= Sales screen hooks ================= */
function salesExtras(){
  if(!$("wrKpis")){const w=document.createElement("div");w.className="wr-kpiwrap";w.innerHTML='<div id="wrKpis"></div>';document.querySelector("#screen-sales .dashgrid").before(w);}
}
const _renderSales=renderSalesDash;
renderSalesDash=function(){
  salesExtras();
  if(LOADING&&!SHOPIFY.length){skeleton($("salesrows"),6);renderKpis();return;}
  _renderSales.apply(this,arguments);
  if(salesView!=="production")decorateRows();
  renderKpis(); paintGreet();
};

/* ================= Factory screen hooks ================= */
function factoryExtras(){
  const grid=document.querySelector("#screen-factory .dashgrid"); if(!grid||$("wrTodayF"))return;
  const t=document.createElement("div");t.id="wrTodayF";t.style.gridColumn="1 / -1";grid.insertBefore(t,grid.firstChild);
}
/* Factory screen tabs: Production | Leaderboard (no scrolling to the bottom to see the board) */
let FTAB="prod";
function factoryTabs(){
  const grid=document.querySelector("#screen-factory .dashgrid"); if(!grid)return;
  if(!$("wrFTabs")){const t=document.createElement("div");t.id="wrFTabs";t.className="roletabs wr-ftabs";t.setAttribute("role","tablist");
    t.innerHTML='<button class="roletab" data-t="prod" role="tab">Production</button><button class="roletab" data-t="lb" role="tab">Leaderboard</button>';
    grid.before(t); t.querySelectorAll("[data-t]").forEach(b=>b.onclick=()=>{FTAB=b.dataset.t;factoryTabs();});}
  $("wrFTabs").querySelectorAll("[data-t]").forEach(b=>{const on=b.dataset.t===FTAB;b.classList.toggle("on",on);b.setAttribute("aria-selected",String(on));});
  grid.querySelectorAll(".teamstrip,.dashmain").forEach(el=>el.hidden=FTAB!=="prod");
  const lb=grid.querySelector(".lbcard"); if(lb)lb.hidden=FTAB!=="lb";
}
const _renderFactory=renderFactoryProd;
renderFactoryProd=function(){
  _renderFactory.apply(this,arguments);
  factoryTabs();
  paintGreet();
  if(SPRING){const el=document.querySelector(`.crew[data-ck="${SPRING}"]`);if(el)el.classList.add("wr-spring");SPRING="";}
};

/* ================= crew: Undo toast + spring ================= */
let SPRING="";
const _setCrew=setCrew, _removeCrew=removeCrew;
setCrew=function(id,line,st,name,quiet){
  const o=byId(id); if(!name||(o&&crewList(o,line,st).some(a=>a.n===name)))return;
  SPRING=id+":"+line+":"+st+":"+name;
  _setCrew(id,line,st,name);
  if(!quiet&&o)toast(`${name} on ${STG[st].toLowerCase()} · ${o.order}`,()=>removeCrew(id,line,st,name,true));
};
removeCrew=function(id,line,st,name,quiet){
  const o=byId(id); _removeCrew(id,line,st,name);
  if(!quiet&&o)toast(`${name} removed from ${STG[st].toLowerCase()} · ${o.order}`,()=>setCrew(id,line,st,name,true));
};

/* ================= people: team list + profile cards ================= */
function personStats(name){
  const cutW=Date.now()-7*864e5, cutM=Date.now()-30*864e5, roles=new Set(), days=new Set(); let wk=0,mo=0; const now=[];
  SHOPIFY.forEach(o=>{const cr=o.crew||{},ps=o.prod_stages||[];Object.keys(cr).forEach(line=>{Object.keys(cr[line]).forEach(st=>{const a=crewList(o,line,st).find(x=>x.n===name);if(!a)return;
    roles.add(ROLE_NAME[st]); days.add(a.d);
    const done=(ps[line]||0)>+st||o.state==="shipped", t=pdMs(a.d);
    if(done&&t>=cutW)wk++; if(done&&t>=cutM)mo++;
    if(!done&&(ps[line]||0)===+st&&o.state==="open"){const it=o.items[line]||{};now.push(`${STG[st]} on ${o.order} ${drawBase(it.product)||""}`);} });});});
  let streak=0; for(let d=0;d<60;d++){const k=new Date(Date.now()+4*3600e3-d*864e5).toISOString().slice(0,10);if(days.has(k))streak++;else if(d>0)break;}
  return {roles:[...roles],wk,mo,streak,now};
}
renderWorkers=function(){
  const box=$("workerlist"); if(!box)return; const w=DB.workers(); box.innerHTML="";
  if(!w.length){box.innerHTML='<div class="hint" style="margin:0">No names added yet.</div>';return;}
  w.forEach((n,i)=>{const s=personStats(n),r=document.createElement("div");
    r.className="wr-person"+(CREW_PICK===n?" pick":"");r.draggable=true;r.dataset.wrName=n;
    r.title="Drag onto a stage, or tap then tap a stage";
    r.innerHTML=`<span class="wr-pic" style="background:${colorOf(n)}">${esc(initials(n))}</span><span class="nm"><b></b><span>${esc(s.roles.join(" · ")||"Factory team")}</span></span><span class="wk"><em>${s.wk}</em>this wk</span><button class="del" type="button" title="Remove ${esc(n)}" aria-label="Remove ${esc(n)}">×</button>`;
    r.querySelector(".nm b").textContent=n;
    r.addEventListener("dragstart",e=>{e.dataTransfer.setData("text/plain",n);e.dataTransfer.effectAllowed="copy";hideP();});
    r.addEventListener("click",e=>{if(e.target.closest(".del"))return;CREW_PICK=CREW_PICK===n?"":n;renderWorkers();});
    r.querySelector(".del").onclick=e=>{e.stopPropagation();delWorker(i);};
    box.appendChild(r);});
  if(CREW_PICK){const tip=document.createElement("div");tip.className="hint wr-picktip";tip.textContent="Now tap a stage's + to add "+CREW_PICK+".";box.appendChild(tip);}
};
let pcard=null,pTimer=0;
function showP(el){ const n=el.dataset.wrName||(el.classList.contains("crew")?el.firstChild&&el.firstChild.nodeValue:"")||""; if(!n)return;
  const s=personStats(n.trim());
  pcard.innerHTML=`<div class="ph"><span class="wr-pic" style="background:${colorOf(n)}">${esc(initials(n))}</span><div><b></b><span>${esc(s.roles.join(" · ")||"Factory team")}</span></div></div>
    <dl><div><dt>This week</dt><dd>${s.wk}</dd></div><div><dt>30 days</dt><dd>${s.mo}</dd></div><div><dt>Streak</dt><dd>${s.streak}<span style="font:500 11px var(--w-ui);color:var(--w-muted)"> day${s.streak===1?"":"s"}</span></dd></div></dl>
    <div class="now">${s.now.length?"Now: "+esc(s.now.slice(0,2).join(" · ")):"Not on a piece right now"}</div>`;
  pcard.querySelector(".ph b").textContent=n.trim();
  const r=el.getBoundingClientRect(); let x=r.left, y=r.bottom+8;
  if(x+270>innerWidth)x=innerWidth-270; if(y+190>innerHeight)y=r.top-190;
  pcard.style.left=Math.max(8,x)+"px"; pcard.style.top=Math.max(8,y)+"px"; pcard.classList.add("on"); }
function hideP(){ clearTimeout(pTimer); if(pcard)pcard.classList.remove("on"); }
document.addEventListener("mouseover",e=>{ const el=e.target.closest&&e.target.closest(".wrs [data-wr-name], .wrs .crew:not(.empty)"); if(!el){return;} clearTimeout(pTimer); pTimer=setTimeout(()=>showP(el),220); });
document.addEventListener("mouseout",e=>{ const el=e.target.closest&&e.target.closest(".wrs [data-wr-name], .wrs .crew:not(.empty)"); if(el&&!el.contains(e.relatedTarget))hideP(); });

/* ================= podium leaderboard ================= */
renderLeaderboard=function(){
  [[1,"carpenter"],[2,"foamer"],[3,"fabricator"],[4,"packer"]].forEach(([st,role])=>{
    const box=$("lb-"+role); if(!box)return; const rows=crewBoard(st,lbDays);
    if(!rows.length){box.innerHTML='<div class="hint" style="margin:0">Nothing finished in this period yet.</div>';return;}
    const mx=Math.max(...rows.map(r=>r[1])), order=[1,0,2];
    const pods=order.map(k=>{const r=rows[k];if(!r)return'<div class="wr-pod"></div>';const s=personStats(r[0]).streak;
      return `<div class="wr-pod p${k+1}"><span class="wr-medal wr-m${k+1}">${k+1}</span><span class="nm" data-wr-name="${esc(r[0])}">${esc(r[0])}</span><span class="wr-streak" title="${s}-day streak">${Array.from({length:Math.min(s,7)},()=>"<i></i>").join("")}${s?"":"&nbsp;"}</span><div class="wr-block" style="height:${Math.round(34+50*r[1]/mx)}px"><span class="v">${r[1]}</span><span class="u">piece${r[1]===1?"":"s"}</span></div></div>`;}).join("");
    const rest=rows.slice(3).map((r,i)=>`<div class="lbrow"><span class="lbrank">${i+4}</span><span class="lbname" data-wr-name="${esc(r[0])}">${esc(r[0])}</span><span class="lbcount">${r[1]}<span>piece${r[1]===1?"":"s"}</span></span></div>`).join("");
    box.innerHTML=`<div class="wr-podium">${pods}</div>${rest?`<div class="wr-rest">${rest}</div>`:""}`;
  });
};

/* ================= order drawer: header + stage history ================= */
const _openDetail=openOrderDetail;
openOrderDetail=function(o){
  _openDetail(o); hideP();
  const t=$("od-title"); if(t){const first=(o.items||[])[0];t.insertAdjacentHTML("beforeend",`<span class="wr-sub">${esc(o.customer||"")}${first?" · "+esc(drawBase(first.product)||first.product)+(o.items.length>1?" + "+(o.items.length-1)+" more":""):""}</span>`);}
  if(o.isDraft||!$("od-body"))return;
  const lines=o.items.map((it,i)=>i).filter(i=>isFurnitureLine(o.items[i].product));
  if(!lines.length)return;
  const html=lines.map(i=>{const L=lineInfo(o,i),shipped=o.state==="shipped";
    const steps=STG.map((s,k)=>{const done=shipped||k<L.cur,cur=!shipped&&k===L.cur;const who=crewList(o,i,k).map(a=>a.n).join(", ");const when=k===0?(lineDrawn(o,i)?"Drawing complete":"Awaiting drawing"):k===5?((o.delivery||{})[i]?fmtDelivery(o.delivery[i]):""):(L.pd[k]?"Started "+L.pd[k].slice(8,10)+"/"+L.pd[k].slice(5,7)+" "+L.pd[k].slice(11,16):"");
      return `<div class="s${done?" d":cur?" c":""}"><span class="b">${done?"✓":k+1}</span><div><div class="n">${s}${cur?' <span class="wr-age'+(L.days>=LATE[k]?" late":"")+'">'+L.days+"d</span>":""}</div><div class="m">${esc([who,when].filter(Boolean).join(" · "))||(done||cur?"":"Not started")}</div></div><span></span></div>`;}).join("");
    return (lines.length>1?`<div class="wr-line">${esc(o.items[i].product)}</div>`:"")+`<div class="wr-vt">${steps}</div>`;}).join("");
  $("od-body").insertAdjacentHTML("afterbegin",`<div class="odsec"><h4>Production</h4>${html}</div>`);
};

/* ================= toast / confetti ================= */
let tEl,tTimer;
/* pop-up notifications switched off (Mariam: not needed) — kept as a no-op so callers stay simple */
function toast(msg,undo){ return; clearTimeout(tTimer);
  tEl.innerHTML=`<span></span>${undo?'<button type="button">Undo</button>':""}`; tEl.firstChild.textContent=msg;
  if(undo)tEl.querySelector("button").onclick=()=>{tEl.classList.remove("on");undo();};
  tEl.classList.add("on"); tTimer=setTimeout(()=>tEl.classList.remove("on"),undo?6000:3000); }
window.wrToast=toast;
function confetti(){ if(RM)return; const cv=$("wrConfetti"),cx=cv.getContext("2d"),dpr=devicePixelRatio||1;
  cv.width=innerWidth*dpr;cv.height=innerHeight*dpr;cx.scale(dpr,dpr);
  const cols=["#C9A66B","#A98B54","#F0E6D2","#6B1A22","#DEC089"],P=Array.from({length:120},()=>({x:innerWidth/2+(Math.random()-.5)*160,y:innerHeight*.45,vx:(Math.random()-.5)*11,vy:-Math.random()*12-4,r:Math.random()*6+3,a:Math.random()*6,va:(Math.random()-.5)*.3,c:cols[Math.random()*cols.length|0]}));
  const t0=performance.now();(function f(t){cx.clearRect(0,0,innerWidth,innerHeight);P.forEach(p=>{p.vy+=.35;p.x+=p.vx;p.y+=p.vy;p.a+=p.va;cx.save();cx.translate(p.x,p.y);cx.rotate(p.a);cx.fillStyle=p.c;cx.fillRect(-p.r/2,-p.r/4,p.r,p.r/2);cx.restore();});
    if(t-t0<2200)requestAnimationFrame(f);else cx.clearRect(0,0,innerWidth,innerHeight);})(t0); }

/* ================= ⌘K palette ================= */
let palEl,palScrim,palItems=[],palSel=0;
function commands(){
  const c=[], has=r=>USER&&USER.roles.indexOf(r)>=0;
  if(has("sales"))c.push({t:"New order",s:"Opens the sales form",k:"N",run:()=>openSalesForm(null,"")});
  if(has("sales"))c.push({t:"New drawing",s:"Spec sheet without a sales form",k:"D",run:()=>newDrawing()});
  ["sales","factory","admin"].forEach((r,i)=>{if(has(r)&&ROLE!==r)c.push({t:"Go to "+ROLE_LABEL[r],k:String(i+1),run:()=>switchView(r)});});
  if(has("sales"))c.push({t:"Production status",s:"Every piece and its stage",run:()=>{if(ROLE!=="sales")switchView("sales");setSalesView("production");}});
  if(ROLE!=="admin")c.push({t:(document.body.classList.contains("wr-workshop")?"Turn off":"Turn on")+" tablet mode",s:"Bigger buttons and text",k:"T",run:()=>setWorkshop(!document.body.classList.contains("wr-workshop"))});
  c.push({t:"Refresh orders",run:()=>{if(ROLE==="factory")loadShopify(true).then(renderFactoryProd);else if(ROLE==="admin")loadAdmin();else refreshSales();}});
  c.push({t:"Keyboard shortcuts",k:"?",run:openHelp});
  c.push({t:"Log out",run:logout});
  return c;
}
function openPal(){ if(!USER)return; closeHelp(); palScrim.hidden=false; palEl.hidden=false; const i=palEl.querySelector("input"); i.value=""; palFill(""); i.focus(); }
function closePal(){ palEl.hidden=true; palScrim.hidden=true; }
function palFill(q){
  q=q.replace(/#/g,"").trim().toLowerCase(); const words=q.split(/\s+/).filter(Boolean);
  const hit=s=>words.every(w=>s.indexOf(w)>=0);
  const cmds=commands().filter(c=>!q||hit(c.t.toLowerCase()));
  const pool=ROLE==="factory"?SHOPIFY.filter(o=>!o.isDraft):SHOPIFY;
  const ords=pool.filter(o=>!q||hit((o.order+" "+(o.customer||"")+" "+o.items.map(i=>i.product).join(" ")).toLowerCase().replace(/#/g,"")+" "+o.order.toLowerCase())).slice(0,q?30:6);
  palItems=[]; let h="";
  if(ords.length){h+='<li class="grp">'+(q?"Orders":"Recent orders")+"</li>";ords.forEach(o=>{palItems.push({run:()=>openOrderDetail(o)});
    h+=`<li class="it" role="option" data-i="${palItems.length-1}"><span class="onum">${esc(o.order)}</span><span class="t">${esc(drawBase(o.items[0]&&o.items[0].product)||"")} <span>· ${esc(o.customer||"")}</span></span>${o.isDraft?'<span class="wr-kbd">draft</span>':""}</li>`;});}
  if(cmds.length){h+='<li class="grp">Actions</li>';cmds.forEach(c=>{palItems.push(c);h+=`<li class="it" role="option" data-i="${palItems.length-1}"><span class="t">${esc(c.t)}${c.s?" <span>· "+esc(c.s)+"</span>":""}</span>${c.k?'<span class="wr-kbd">'+esc(c.k)+"</span>":""}</li>`;});}
  if(!palItems.length)h='<li class="grp">No match. Try an order number, a customer or a product.</li>';
  palEl.querySelector("ul").innerHTML=h; palSel=0; palMark();
}
function palMark(){ palEl.querySelectorAll("li.it").forEach(li=>{const on=+li.dataset.i===palSel;li.setAttribute("aria-selected",String(on));if(on)li.scrollIntoView({block:"nearest"});}); }
function palRun(i){ const it=palItems[i]; closePal(); if(it)it.run(); }

/* ================= shortcuts help ================= */
let helpEl;
function openHelp(){ closePal(); palScrim.hidden=false; helpEl.hidden=false; helpEl.querySelector(".close").focus(); }
function closeHelp(){ if(helpEl){helpEl.hidden=true;} if(palEl&&palEl.hidden&&palScrim)palScrim.hidden=true; }

document.addEventListener("keydown",e=>{
  if(!USER)return;
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"&&(onStaff()||!palEl.hidden)){e.preventDefault();palEl.hidden?openPal():closePal();return;}
  if(!palEl.hidden){
    if(e.key==="Escape"){closePal();return;}
    if(e.key==="ArrowDown"){e.preventDefault();palSel=Math.min(palItems.length-1,palSel+1);palMark();return;}
    if(e.key==="ArrowUp"){e.preventDefault();palSel=Math.max(0,palSel-1);palMark();return;}
    if(e.key==="Enter"){e.preventDefault();palRun(palSel);return;}
    return;
  }
  if(e.key==="Escape"){ if(!helpEl.hidden){closeHelp();return;} if(!$("orderdetail").hidden){closeOrderDetail();return;} }
  const a=document.activeElement; if(a&&/INPUT|TEXTAREA|SELECT/.test(a.tagName))return;
  if(e.metaKey||e.ctrlKey||e.altKey||!onStaff()||!$("orderdetail").hidden)return;
  const k=e.key, has=r=>USER.roles.indexOf(r)>=0;
  if(k==="/"){e.preventDefault();const s=curScreen()==="screen-factory"?$("ordersearch"):$("salessearch");if(s&&curScreen()!=="screen-admin")s.focus();}
  else if(k==="?"){e.preventDefault();openHelp();}
  else if(k==="1"||k==="2"||k==="3"){const r=["sales","factory","admin"][+k-1];if(has(r))switchView(r);}
  else if((k==="t"||k==="T")&&curScreen()!=="screen-admin")setWorkshop(!document.body.classList.contains("wr-workshop"));
  else if((k==="n"||k==="N")&&has("sales"))openSalesForm(null,"");
  else if((k==="d"||k==="D")&&has("sales"))newDrawing();
});

/* ================= boot ================= */
function mountOverlays(){
  const wrap=document.createElement("div"); wrap.className="wr-ov";
  wrap.innerHTML=`<div class="wr-scrim" hidden></div>
    <div class="wr-pal" role="dialog" aria-label="Jump to an order" hidden><input type="text" placeholder="Order number, customer, product or an action" autocomplete="off" aria-label="Search"><ul role="listbox"></ul>
      <div class="pf"><span><span class="wr-kbd">↑↓</span> move</span><span><span class="wr-kbd">↵</span> open</span><span><span class="wr-kbd">esc</span> close</span></div></div>
    <div class="wr-help" role="dialog" aria-label="Keyboard shortcuts" hidden><h3>Shortcuts</h3>
      <div class="kr"><span>Jump to any order</span><span class="wr-kbd">⌘K</span></div>
      <div class="kr"><span>Search this list</span><span class="wr-kbd">/</span></div>
      <div class="kr"><span>Sales · Factory · Admin</span><span><span class="wr-kbd">1</span> <span class="wr-kbd">2</span> <span class="wr-kbd">3</span></span></div>
      <div class="kr"><span>New order · New drawing</span><span><span class="wr-kbd">N</span> <span class="wr-kbd">D</span></span></div>
      <div class="kr"><span>Tablet mode (bigger buttons)</span><span class="wr-kbd">T</span></div>
      <div class="kr"><span>Close anything</span><span class="wr-kbd">esc</span></div>
      <button type="button" class="close">Close</button></div>
    <div class="wr-toast" role="status" aria-live="polite"></div><div class="wr-pcard" aria-hidden="true"></div><canvas id="wrConfetti"></canvas>`;
  document.body.appendChild(wrap);
  palScrim=wrap.querySelector(".wr-scrim"); palEl=wrap.querySelector(".wr-pal"); helpEl=wrap.querySelector(".wr-help");
  tEl=wrap.querySelector(".wr-toast"); pcard=wrap.querySelector(".wr-pcard");
  palScrim.onclick=()=>{closePal();closeHelp();};
  helpEl.querySelector(".close").onclick=closeHelp;
  const inp=palEl.querySelector("input"); inp.oninput=()=>palFill(inp.value);
  palEl.querySelector("ul").addEventListener("click",e=>{const li=e.target.closest("li.it");if(li)palRun(+li.dataset.i);});
  palEl.querySelector("ul").addEventListener("mousemove",e=>{const li=e.target.closest("li.it");if(li&&+li.dataset.i!==palSel){palSel=+li.dataset.i;palMark();}});
}
/* entering a screen: avatar, and workshop mode on by default for factory logins (remembered per device) */
const _enterDash=enterDash;
enterDash=function(){ paintAvatar(); const pref=store.get("workshop",null);
  setWorkshop(pref==null?ROLE==="factory":pref==="1",true,true);
  return _enterDash.apply(this,arguments); };
const _renderRoleSwitch=renderRoleSwitch;
renderRoleSwitch=function(){ _renderRoleSwitch.apply(this,arguments); paintAvatar(); };

mountOverlays(); setupBars();
})();
