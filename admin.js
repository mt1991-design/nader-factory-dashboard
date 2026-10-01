/* ================= Admin (owners): sales insights · agent leaderboard · activity log =================
   Data: /api/admin/sales → every order from the last 13 months (agent from the order note "Agent: …",
   else the Shopify staff account that created the draft, named once by the owners below). Totals include VAT;
   cancelled / refunded / voided orders are left out. */
(function(){
"use strict";
const $=id=>document.getElementById(id);
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const ym=d=>String(d).slice(0,7);
const ymLabel=k=>MON[+k.slice(5,7)-1]+" "+k.slice(0,4);
const aed=n=>"AED "+Math.round(n).toLocaleString("en-US");
const aedK=n=>n>=1e6?"AED "+(n/1e6).toFixed(n>=1e7?0:1)+"M":n>=1e3?"AED "+Math.round(n/1e3)+"k":aed(n);
const pct=(a,b)=>b?Math.round((a-b)/b*100):null;
const CAT=t=>{t=String(t||"").toLowerCase();
  if(/cushion|pillow|throw|fabric|swatch|delivery|installation|service|fee|seat\s*depth|upgrade|product\s*test|\btest\b/.test(t))return"Extras & services";
  if(/bedside|side\s*table|night\s*stand|coffee\s*table|dining\s*table|console|desk|sideboard|\btable\b/.test(t))return"Tables";
  if(/\b(bed|headboard)s?\b/.test(t)&&!/day\s*-?bed|sofa\s*bed/.test(t))return"Beds";
  if(/stool|arm\s*chair|armchair|\bchairs?\b/.test(t))return"Chairs & stools";
  if(/sofa|sectional|corner|seater|couch|chaise|modular|day\s*-?bed|loveseat/.test(t))return"Sofas";
  if(/ottoman|pouf|bench/.test(t))return"Ottomans & benches";
  if(/cushion|pillow|throw|fabric|swatch|delivery|installation|service|fee|seat\s*depth|upgrade|product\s*test|\btest\b/.test(t))return"Extras & services";
  return"Other";};
const clean=t=>String(t||"").split(/\s+size\b|\s[-–|]\s|[:|(]|\s\d{2,}/i)[0].trim()||String(t||"");
/* One product, one total: "Namba corner sofa", "Namba Corner Sofa" and "Custom Namba sofa" are the same model.
   Key = the model words left after dropping capitals, sizes and generic words (corner, sofa, custom, the …),
   plus the category; keys one letter apart (a typo like "Ladborke") are merged too. */
const GENERIC=new Set("the a an custom bespoke new corner sofa sofas couch seater seat set of x with and in leather velvet boucle bouclé chenille fabric linen look l u shape shaped modular sectional chaise bed beds headboard king queen super single double chair chairs armchair dining stool stools barstool bar table tables coffee side bench ottoman collection design size standard left right hand facing lhf rhf".split(" "));
function modelKey(t){const c=CAT(t);const w=clean(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z\s]/g," ").split(/\s+/).filter(x=>x&&!GENERIC.has(x)&&x.length>1);
  return (w.slice(0,2).join(" ")||clean(t).toLowerCase())+"|"+c;}
function lev1(a,b){if(a===b)return true;if(Math.abs(a.length-b.length)>1||Math.min(a.length,b.length)<5)return false;let i=0,j=0,d=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++d>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}return d+(a.length-i)+(b.length-j)<=1;}
const titleCase=t=>String(t).toLowerCase().replace(/\b([a-z])/g,m=>m.toUpperCase());
/* group line items → [{name, cat, q, v, names:Set}] */
function groupProducts(lines){
  const G={};
  lines.forEach(([title,q,price])=>{let k=modelKey(title);
    if(!G[k]){const hit=Object.keys(G).find(x=>x.split("|")[1]===k.split("|")[1]&&lev1(x.split("|")[0],k.split("|")[0]));if(hit)k=hit;}
    const g=G[k]=G[k]||{q:0,v:0,cat:CAT(title),names:{}};g.q+=q;g.v+=q*price;const n=clean(title);g.names[n]=(g.names[n]||0)+q;});
  return Object.values(G).map(g=>{const best=Object.entries(g.names).sort((a,b)=>b[1]-a[1])[0][0];return {name:titleCase(best),cat:g.cat,q:g.q,v:g.v,variants:Object.keys(g.names)};});
}
const PAL=["#6B1A22","#A98B54","#3F5E73","#5F6B3A","#8A4B2A","#7A5A9A","#2E6A5E","#9A4C62"];
const isAgent=a=>a!=="Online order"&&a!=="Website"&&!/^Other/.test(a);

let DATA=null,LOADING=false,TAB="sales",MONTH="",AGENT="all",LBP="month",PER_A="",PER_S="";

function rows(){return (DATA&&DATA.rows||[]).filter(r=>r.st!=="x");}
function sum(list,f){return list.reduce((a,r)=>a+f(r),0);}
function items(r){return r.it.reduce((a,x)=>a+x[1],0);}
function inRange(r,from,to){return r.d>=from&&r.d<=to;}

/* ---------- layout ---------- */
function mount(){
  const sc=$("screen-admin"); if(!sc||$("adTabs"))return;
  const grid=sc.querySelector(".dashgrid"); grid.id="adActivity";
  const tabs=document.createElement("div"); tabs.id="adTabs"; tabs.className="roletabs wr-ftabs"; tabs.setAttribute("role","tablist");
  tabs.innerHTML='<button class="roletab" data-t="sales" role="tab">Sales insights</button><button class="roletab" data-t="lb" role="tab">Leaderboard</button><button class="roletab" data-t="log" role="tab">Activity log</button>';
  grid.before(tabs);
  const s=document.createElement("div"); s.id="adSales"; s.className="ad-wrap"; grid.before(s);
  const l=document.createElement("div"); l.id="adLb"; l.className="ad-wrap"; grid.before(l);
  tabs.querySelectorAll("[data-t]").forEach(b=>b.onclick=()=>{TAB=b.dataset.t;show();});
  const bar=sc.querySelector(".topbar .topttl"); if(bar)bar.textContent="Admin · Owners";
}
function show(){
  $("adTabs").querySelectorAll("[data-t]").forEach(b=>{const on=b.dataset.t===TAB;b.classList.toggle("on",on);b.setAttribute("aria-selected",String(on));});
  $("adSales").hidden=TAB!=="sales"; $("adLb").hidden=TAB!=="lb"; $("adActivity").hidden=TAB!=="log";
  if(TAB!=="log"&&!DATA&&!LOADING)load(); else render();
}
function load(fresh){
  LOADING=true; ["adSales","adLb"].forEach(id=>{const el=$(id);if(el&&!DATA)el.innerHTML='<div class="ad-card ad-loading">Loading 13 months of orders from Shopify…</div>';});
  fetch("/api/admin/sales"+(fresh?"?fresh=1":""),{credentials:"same-origin"}).then(r=>r.json()).then(d=>{LOADING=false;
    if(!d||!d.ok){["adSales","adLb"].forEach(id=>$(id).innerHTML='<div class="ad-card ad-loading">Couldn\'t load the sales data. Try Refresh.</div>');return;}
    DATA=d; if(!MONTH)MONTH=ym(new Date(Date.now()+4*3600e3).toISOString()); render();})
  .catch(()=>{LOADING=false;$("adSales").innerHTML='<div class="ad-card ad-loading">Network error loading sales.</div>';});
}
function render(){ if(!DATA)return; if(TAB==="sales")renderSales(); if(TAB==="lb")renderLb(); }

/* ---------- SALES INSIGHTS ---------- */
function months(){const s=new Set(rows().map(r=>ym(r.d)));return [...s].sort().reverse();}
/* periods: a month "2026-09", a whole year "Y:2026" or the last three months "L3" */
function perRange(p){ const now=new Date(Date.now()+4*3600e3).toISOString().slice(0,10);
  if(/^Y:/.test(p)){const y=p.slice(2);return [y+"-01-01",y+"-12-31"];}
  if(p==="L3"){const d=new Date(now+"T00:00:00Z");d.setUTCMonth(d.getUTCMonth()-2);return [d.toISOString().slice(0,7)+"-01",now];}
  return [p+"-01",p+"-31"]; }
function perLabel(p){ return /^Y:/.test(p)?"All of "+p.slice(2):p==="L3"?"Last 3 months":ymLabel(p); }
function perPrev(p){ if(/^Y:/.test(p)||p==="L3")return null; return prevMonth(p); }
function inPer(r,p){ const [a,b]=perRange(p); return r.d>=a&&r.d<=b; }
function perOptions(sel){ const ms=months(), years=[...new Set(ms.map(m=>m.slice(0,4)))].sort().reverse();
  return '<optgroup label="Longer">'+years.map(y=>`<option value="Y:${y}"${sel==="Y:"+y?" selected":""}>All of ${y}</option>`).join("")+`<option value="L3"${sel==="L3"?" selected":""}>Last 3 months</option></optgroup>`
    +years.map(y=>`<optgroup label="${y}">`+ms.filter(m=>m.slice(0,4)===y).map(k=>`<option value="${k}"${k===sel?" selected":""}>${ymLabel(k)}</option>`).join("")+'</optgroup>').join(""); }
function prevMonth(k){const y=+k.slice(0,4),m=+k.slice(5,7);return m===1?(y-1)+"-12":y+"-"+String(m-1).padStart(2,"0");}
function renderSales(){
  const all=rows(), ms=months(); if(!ms.includes(MONTH))MONTH=ms[0]||MONTH; if(!PER_A)PER_A=MONTH; if(!PER_S)PER_S=MONTH;
  const agents=[...new Set(all.map(r=>r.a))].sort((a,b)=>sum(all.filter(r=>r.a===b),r=>r.t)-sum(all.filter(r=>r.a===a),r=>r.t));
  const f=r=>AGENT==="all"||r.a===AGENT;
  const cur=all.filter(r=>ym(r.d)===MONTH&&f(r)), prev=all.filter(r=>ym(r.d)===prevMonth(MONTH)&&f(r));
  const rev=sum(cur,r=>r.t), revP=sum(prev,r=>r.t), n=cur.length, nP=prev.length, it=sum(cur,items), itP=sum(prev,items);
  const aov=n?rev/n:0, aovP=nP?revP/nP:0;
  const open=all.filter(r=>r.open&&f(r)), late=open.filter(r=>r.p&&r.p.over>0);
  /* refunds & cancellations in the month (cancelled / refunded / voided orders + partial refunds on kept orders) */
  const allR=(DATA.rows||[]).filter(f);
  const refRows=allR.filter(r=>ym(r.d)===MONTH&&(r.st==="x"||(r.rf||0)>0.5));
  const refAmt=sum(refRows,r=>r.st==="x"?(r.rf>0.5?r.rf:r.t):r.rf), refN=refRows.length;
  const delta=(a,b)=>{const p=pct(a,b);return p==null?'<span class="ad-d">—</span>':'<span class="ad-d '+(p>=0?"up":"down")+'">'+(p>=0?"▲":"▼")+" "+Math.abs(p)+'% vs '+MON[+prevMonth(MONTH).slice(5,7)-1]+'</span>';};
  let h=`<div class="ad-toolbar">
      <label>Month <select id="adMonth">${ms.map(k=>`<option value="${k}"${k===MONTH?" selected":""}>${ymLabel(k)}</option>`).join("")}</select></label>
      <label>Sales agent <select id="adAgent"><option value="all">Everyone</option>${agents.map(a=>`<option${a===AGENT?" selected":""}>${esc(a)}</option>`).join("")}</select></label>
      <button type="button" class="ad-btn" id="adRefresh">↻ Refresh</button>
      <span class="ad-note">Totals include VAT · cancelled and refunded orders left out</span></div>
    <div class="ad-kpis">
      <div class="ad-kpi"><div class="l">Sales · ${ymLabel(MONTH)}</div><div class="v ad-exact">${aed(rev)}</div>${delta(rev,revP)}</div>
      <div class="ad-kpi"><div class="l">Orders</div><div class="v">${n}</div>${delta(n,nP)}</div>
      <div class="ad-kpi"><div class="l">Items sold</div><div class="v">${it}</div>${delta(it,itP)}</div>
      <div class="ad-kpi"><div class="l">Average order</div><div class="v ad-exact">${aed(aov)}</div>${delta(aov,aovP)}</div>
      <div class="ad-kpi"><div class="l">Open orders (not shipped)</div><div class="v">${open.length}</div><span class="ad-d">${aed(sum(open,r=>r.t))} in the workshop</span></div>
      <div class="ad-kpi warn"><div class="l">Refunds &amp; cancellations</div><div class="v ad-exact">${aed(refAmt)}</div><span class="ad-d">${refN} order${refN===1?"":"s"} · ${ymLabel(MONTH)}</span></div>
      <div class="ad-kpi warn"><div class="l">Past the promised date</div><div class="v">${late.length}</div><span class="ad-d">${open.length?Math.round(late.length/open.length*100):0}% of open orders</span></div>
    </div>`;
  h+=`<div class="ad-card"><div class="ad-h">Sales per month, by agent <span>last 12 months</span></div>${chart(all.filter(f),agents)}</div>`;
  /* agent table */
  const byA={}; all.filter(r=>inPer(r,PER_A)).forEach(r=>{const a=byA[r.a]=byA[r.a]||{a:r.a,rev:0,n:0,it:0,lines:[]};a.rev+=r.t;a.n++;a.it+=items(r);r.it.forEach(x=>a.lines.push(x));});
  const byAP={}, pp=perPrev(PER_A); if(pp) all.filter(r=>ym(r.d)===pp).forEach(r=>{byAP[r.a]=(byAP[r.a]||0)+r.t;});
  const list=Object.values(byA).sort((a,b)=>b.rev-a.rev), tot=sum(list,x=>x.rev)||1;
  h+=`<div class="ad-card"><div class="ad-h">Sales agents · ${perLabel(PER_A)} <span>click an agent to see everything they sold</span><select class="ad-per" id="adPerA" aria-label="Period for the agents table">${perOptions(PER_A)}</select></div>
    <div class="ad-tablewrap"><table class="ad-table"><thead><tr><th>Agent</th><th>Orders</th><th>Items</th><th>Sales</th><th>Avg order</th><th>Top product</th><th>Share</th><th>vs last month</th></tr></thead><tbody>
    ${list.map(x=>{const g=groupProducts(x.lines).sort((a,b)=>b.q-a.q)[0];const top=g?[g.name,g.q]:null;const p=pct(x.rev,byAP[x.a]||0);
      return `<tr data-agent="${esc(x.a)}"${x.a===AGENT?' class="on"':''}><td><b>${esc(x.a)}</b></td><td>${x.n}</td><td>${x.it}</td><td><b>${aed(x.rev)}</b></td><td>${aed(x.rev/x.n)}</td><td>${top?esc(top[0])+' <span class="ad-m">×'+top[1]+'</span>':""}</td>
        <td><span class="ad-bar"><i style="width:${Math.round(x.rev/tot*100)}%"></i></span> ${Math.round(x.rev/tot*100)}%</td><td>${p==null?'<span class="ad-m">new</span>':'<span class="ad-d '+(p>=0?"up":"down")+'">'+(p>=0?"▲":"▼")+" "+Math.abs(p)+"%</span>"}</td></tr>`;}).join("")||'<tr><td colspan="8" class="ad-m">No sales this month yet.</td></tr>'}
    </tbody></table></div></div>`;
  /* drill-down: what was sold (for the chosen agent, or everyone) */
  const curS=all.filter(r=>inPer(r,PER_S)&&f(r));
  const cats={},city={},lines=[];
  curS.forEach(r=>{r.it.forEach(x=>{lines.push(x);const c=cats[CAT(x[0])]=cats[CAT(x[0])]||{q:0,v:0};c.q+=x[1];c.v+=x[1]*x[2];});
    const c0=String(r.city||"").trim().replace(/\s+/g," "),ct=c0?c0.charAt(0).toUpperCase()+c0.slice(1).toLowerCase().replace(/\b(\w)/g,m=>m.toUpperCase()):"Unknown";city[ct]=(city[ct]||0)+1;});
  const plist=groupProducts(lines).sort((a,b)=>b.v-a.v), clist=Object.entries(cats).sort((a,b)=>b[1].v-a[1].v), cityL=Object.entries(city).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const cmax=Math.max(1,...clist.map(c=>c[1].v)), citymax=Math.max(1,...cityL.map(c=>c[1]));
  h+=`<div class="ad-grid2">
    <div class="ad-card"><div class="ad-h">What ${AGENT==="all"?"we":esc(AGENT)} sold · ${perLabel(PER_S)} <span>${plist.length} product${plist.length===1?"":"s"}</span><select class="ad-per" id="adPerS" aria-label="Period for what we sold">${perOptions(PER_S)}</select></div>
      <div class="ad-tablewrap ad-scroll"><table class="ad-table"><thead><tr><th>Product</th><th>Category</th><th>Qty</th><th>Value</th></tr></thead><tbody>
      ${plist.map(p=>`<tr><td>${esc(p.name)}${p.variants.length>1?' <span class="ad-m" title="Added up from: '+esc(p.variants.join(" · "))+'">· '+p.variants.length+' spellings added up</span>':''}</td><td class="ad-m">${p.cat}</td><td>${p.q}</td><td>${aed(p.v)}</td></tr>`).join("")||'<tr><td colspan="4" class="ad-m">Nothing sold this month yet.</td></tr>'}</tbody></table></div></div>
    <div class="ad-stack">
      <div class="ad-card"><div class="ad-h">By category</div>${clist.map(([k,c])=>`<div class="ad-row"><span>${k}</span><span class="ad-bar wide"><i style="width:${Math.round(c.v/cmax*100)}%"></i></span><span class="ad-num">${c.q} · ${aedK(c.v)}</span></div>`).join("")||'<div class="ad-m">—</div>'}</div>
      <div class="ad-card"><div class="ad-h">Where customers are</div>${cityL.map(([k,c])=>`<div class="ad-row"><span>${esc(k)}</span><span class="ad-bar wide gold"><i style="width:${Math.round(c/citymax*100)}%"></i></span><span class="ad-num">${c}</span></div>`).join("")||'<div class="ad-m">—</div>'}</div>
    </div></div>`;
  /* refunds & cancellations list */
  h+=`<div class="ad-card"><div class="ad-h">Refunds &amp; cancellations · ${ymLabel(MONTH)} <span>${aed(refAmt)} across ${refN} order${refN===1?"":"s"}</span></div>
    <div class="ad-tablewrap"><table class="ad-table"><thead><tr><th>Order</th><th>Ordered</th><th>Agent</th><th>Product</th><th>Order total</th><th>Refunded</th><th>What happened</th></tr></thead><tbody>
    ${refRows.sort((a,b)=>b.d.localeCompare(a.d)).map(r=>{const amt=r.st==="x"?(r.rf>0.5?r.rf:r.t):r.rf;const what=r.cx?("Cancelled "+r.cx+(r.why?" · "+r.why:"")):r.fin==="refunded"?"Fully refunded":r.fin==="voided"?"Voided":"Partly refunded";
      return `<tr><td><b>${esc(r.n)}</b></td><td>${r.d}</td><td>${esc(r.a)}</td><td>${esc(clean(r.it[0]&&r.it[0][0]))}</td><td>${aed(r.t)}</td><td><b>${aed(amt)}</b></td><td class="ad-m">${esc(what)}</td></tr>`;}).join("")||'<tr><td colspan="7" class="ad-m">No refunds or cancellations this month.</td></tr>'}</tbody></table></div></div>`;
  /* overdue list */
  const lateL=late.slice().sort((a,b)=>b.p.over-a.p.over).slice(0,10);
  h+=`<div class="ad-card"><div class="ad-h">Most overdue open orders <span>working days past what the customer was promised</span></div>
    <div class="ad-tablewrap"><table class="ad-table"><thead><tr><th>Order</th><th>Ordered</th><th>Agent</th><th>Product</th><th>Promised</th><th>Over</th></tr></thead><tbody>
    ${lateL.map(r=>`<tr><td><b>${esc(r.n)}</b></td><td>${r.d}</td><td>${esc(r.a)}</td><td>${esc(clean(r.it[0]&&r.it[0][0]))}</td><td>${r.p.lo}–${r.p.hi} days</td><td><span class="promise late">−${r.p.over}</span></td></tr>`).join("")||'<tr><td colspan="6" class="ad-m">Nothing overdue. 🎉</td></tr>'}</tbody></table></div></div>`;
  /* name the Shopify staff accounts */
  const acc=Object.entries(DATA.accounts||{}).sort((a,b)=>b[1].n-a[1].n);
  const ex=uid=>rows().filter(r=>String(r.u)===uid).sort((a,b)=>b.d.localeCompare(a.d)).slice(0,2);
  if(acc.length) h+=`<div class="ad-card"><div class="ad-h">Who is each Shopify staff account? <span>Older orders only know which Shopify account created them. Tap "Who is this?" (opens their page in Shopify, the name is at the top) or open one of their orders, then type the name once. Use the same spelling as the sales form so their orders add up.</span></div>
    <div class="ad-accts">${acc.map(([uid,a])=>`<label class="ad-acct"><span>Account …${uid.slice(-4)} <em>${a.n} orders</em></span>
      <span class="ad-m"><a href="https://admin.shopify.com/store/91fb05/settings/account/${uid}" target="_blank" rel="noopener">Who is this? ↗</a> · e.g. ${ex(uid).map(r=>`<a href="https://admin.shopify.com/store/91fb05/orders/${r.id}" target="_blank" rel="noopener">${esc(r.n)}</a>`).join(", ")}</span>
      <input type="text" data-uid="${uid}" value="${esc(a.name||"")}" placeholder="Agent name"></label>`).join("")}</div></div>`;
  $("adSales").innerHTML=h;
  $("adMonth").onchange=e=>{MONTH=PER_A=PER_S=e.target.value;renderSales();};
  $("adPerA").onchange=e=>{PER_A=e.target.value;renderSales();};
  $("adPerS").onchange=e=>{PER_S=e.target.value;renderSales();};
  $("adAgent").onchange=e=>{AGENT=e.target.value;renderSales();};
  $("adRefresh").onclick=()=>{DATA=null;load(true);};
  $("adSales").querySelectorAll("tr[data-agent]").forEach(tr=>tr.onclick=()=>{AGENT=AGENT===tr.dataset.agent?"all":tr.dataset.agent;renderSales();});
  $("adSales").querySelectorAll("input[data-uid]").forEach(inp=>inp.onchange=()=>{
    fetch("/api/admin/agents",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({uid:inp.dataset.uid,name:inp.value})})
      .then(r=>r.json()).then(d=>{if(d&&d.ok){DATA=null;load(true);}else alert("Couldn't save the name.");});});
}
function chart(list,agents){
  const now=new Date(Date.now()+4*3600e3), ks=[];
  for(let k=11;k>=0;k--){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-k,1));ks.push(d.toISOString().slice(0,7));}
  const top=agents.filter(isAgent).slice(0,6), key=a=>top.includes(a)?a:"Others";
  const series=[...top,"Others"], M={};
  ks.forEach(k=>M[k]={}); list.forEach(r=>{const k=ym(r.d);if(M[k]){const a=key(r.a);M[k][a]=(M[k][a]||0)+r.t;}});
  const tot=ks.map(k=>sum(Object.values(M[k]),x=>x)), mx=Math.max(1,...tot);
  const W=720,H=200,bw=W/12*.62,step=W/12;
  let bars="";
  ks.forEach((k,i)=>{let y=H;series.forEach((a,j)=>{const v=M[k][a]||0;if(!v)return;const h=v/mx*(H-18);y-=h;
    bars+=`<rect x="${(i*step+(step-bw)/2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,h-1).toFixed(1)}" rx="2" fill="${a==="Others"?"#cdbcb1":PAL[j%PAL.length]}"><title>${ymLabel(k)} · ${esc(a)}: ${aed(v)}</title></rect>`;});
    bars+=`<text x="${(i*step+step/2).toFixed(1)}" y="${H+14}" text-anchor="middle" font-size="10" fill="#7A6865">${MON[+k.slice(5,7)-1]}</text>`;
    if(tot[i])bars+=`<text x="${(i*step+step/2).toFixed(1)}" y="${(H-tot[i]/mx*(H-18)-4).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#4A3B3C">${aedK(tot[i]).replace("AED ","")}</text>`;});
  const legend=series.filter(a=>ks.some(k=>M[k][a])).map((a,j)=>`<span><i style="background:${a==="Others"?"#cdbcb1":PAL[series.indexOf(a)%PAL.length]}"></i>${esc(a)}</span>`).join("");
  return `<div class="ad-chart"><svg viewBox="0 0 ${W} ${H+20}" role="img" aria-label="Sales per month by agent">${bars}</svg></div><div class="ad-legend">${legend}</div>`;
}

/* ---------- LEADERBOARD ---------- */
function period(){const now=new Date(Date.now()+4*3600e3),t=now.toISOString().slice(0,10),mk=now.toISOString().slice(0,7);
  if(LBP==="month")return [mk+"-01",t,"This month"];
  if(LBP==="last"){const p=prevMonth(mk);return [p+"-01",p+"-31","Last month"];}
  if(LBP==="q"){const d=new Date(now);d.setUTCMonth(d.getUTCMonth()-2);return [d.toISOString().slice(0,7)+"-01",t,"Last 3 months"];}
  return [now.getUTCFullYear()+"-01-01",t,"This year"];}
function renderLb(){
  const [from,to,label]=period(), list=rows().filter(r=>inRange(r,from,to)&&isAgent(r.a));
  const by={}; list.forEach(r=>{const a=by[r.a]=by[r.a]||{a:r.a,rev:0,n:0,it:0,big:0,bigN:""};a.rev+=r.t;a.n++;a.it+=items(r);if(r.t>a.big){a.big=r.t;a.bigN=r.n;}});
  const L=Object.values(by).sort((a,b)=>b.rev-a.rev), mx=Math.max(1,...L.map(x=>x.rev));
  const pod=[1,0,2].map(k=>{const x=L[k];if(!x)return'<div class="ad-pod"></div>';
    return `<div class="ad-pod p${k+1}"><span class="wr-medal wr-m${k+1}">${k+1}</span><b>${esc(x.a)}</b><span class="ad-m">${x.n} orders · ${x.it} items</span><div class="wr-block" style="height:${Math.round(40+80*x.rev/mx)}px"><span class="v">${aedK(x.rev).replace("AED ","")}</span><span class="u">AED</span></div></div>`;}).join("");
  const award=(t,x,v)=>x?`<div class="ad-award"><span>${t}</span><b>${esc(x.a)}</b><em>${v}</em></div>`:"";
  const mostItems=L.slice().sort((a,b)=>b.it-a.it)[0], bigOne=L.slice().sort((a,b)=>b.big-a.big)[0], bestAov=L.filter(x=>x.n>=3).sort((a,b)=>b.rev/b.n-a.rev/a.n)[0], mostOrders=L.slice().sort((a,b)=>b.n-a.n)[0];
  $("adLb").innerHTML=`<div class="ad-toolbar"><div class="wr-seg ad-seg">${[["month","This month"],["last","Last month"],["q","Last 3 months"],["year","This year"]].map(([k,t])=>`<button type="button" data-p="${k}" aria-pressed="${k===LBP}">${t}</button>`).join("")}</div><span class="ad-note">${label} · by sales (incl. VAT)</span></div>
    <div class="ad-card"><div class="ad-h">Sales agent leaderboard · ${label}</div>${L.length?`<div class="ad-podium">${pod}</div>`:'<div class="ad-m" style="padding:20px 0">No sales in this period yet.</div>'}
      <div class="ad-rank">${L.map((x,i)=>`<div class="ad-rrow"><span class="r">${i+1}</span><b>${esc(x.a)}</b><span class="ad-bar wide"><i style="width:${Math.round(x.rev/mx*100)}%"></i></span><span class="ad-num">${aed(x.rev)}</span><span class="ad-m">${x.n} orders · ${x.it} items</span></div>`).join("")}</div></div>
    <div class="ad-awards">${award("Most items sold",mostItems,mostItems?mostItems.it+" items":"")}${award("Most orders",mostOrders,mostOrders?mostOrders.n+" orders":"")}${award("Biggest single order",bigOne,bigOne?aed(bigOne.big)+" · "+bigOne.bigN:"")}${award("Best average order (3+ orders)",bestAov,bestAov?aed(bestAov.rev/bestAov.n):"")}</div>`;
  $("adLb").querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{LBP=b.dataset.p;renderLb();});
}

/* ---------- hook into the admin screen ---------- */
const _enterAdmin=enterAdmin;
enterAdmin=function(){ _enterAdmin.apply(this,arguments); mount(); show(); };
})();
