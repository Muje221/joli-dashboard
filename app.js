/* ============================================================
   Joli Monitoring — Marketing Dashboard v2
   Connected to Google Sheets (Daily Performance)
============================================================ */

const SHEET_ID  = "18pvf_fuBjtBdYX4CAFgFCAmaYIRLpVGzsG_0FX0LqfY";
const SHEET_GID = "1602116591";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}&tq=${encodeURIComponent("select *")}`;

/* === Column indexes (0-based) === */
const COL = {
  year:1, month:2, day:3,
  webTraffic:5, imp:6, click:7, ctr:8,
  orders:9, cr:10, costOrder:11, aov:12,
  totalSpend:14, totalRevenue:15, accountRevenue:16, roas:17,
  channels:{
    "Google Ads":  {spend:19,imp:20,click:21,trans:22,revenue:23,roas:24,color:"#3b82f6"},
    "Snapchat":    {spend:26,imp:27,click:28,trans:29,revenue:30,roas:31,color:"#facc15"},
    "Meta":        {spend:33,imp:34,click:35,trans:36,revenue:37,roas:38,color:"#1877f2"},
    "TikTok":      {spend:40,imp:41,click:42,trans:43,revenue:44,roas:45,color:"#ec4899"},
    "X":           {spend:47,imp:null,click:null,trans:null,revenue:48,roas:49,color:"#a855f7"},
    "Influencer":  {spend:51,imp:52,click:53,trans:54,revenue:55,roas:56,color:"#10b981"},
    "WhatsApp":    {spend:58,imp:59,click:60,trans:61,revenue:62,roas:63,color:"#22c55e"}
  }
};

/* === State === */
let RAW_ROWS      = [];
let ACTIVE_CHANNELS = new Set(Object.keys(COL.channels));
let CHARTS        = {};
let CURRENT_TAB   = "overview";
let CURRENT_PERIOD= "all";
let GROUP_BY      = "day";
let COMPARE_ON    = false;
let TREND_METRIC  = "both";
let TOP_N         = "all";

/* table sort state */
let TABLE_SORT_COL = null;
let TABLE_SORT_DIR = 1; // 1=asc, -1=desc

/* ============================================================
   Helpers
============================================================ */
const num = v => {
  if(v==null||v==="") return 0;
  const n = parseFloat(String(v).replace(/[,٬\s%"$]/g,""));
  return isNaN(n)?0:n;
};
const fmt      = (n,d=0) => Number(n||0).toLocaleString("en-US",{maximumFractionDigits:d});
const fmtMoney = n => fmt(n,0);

function parseRowDate(str){
  if(!str) return null;
  const m = String(str).match(/(\d{1,2})\/([A-Za-z]+)\/(\d{4})/);
  if(!m) return null;
  const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  return new Date(+m[3], months[m[2]]??0, +m[1]);
}

function fmtDateShort(d){
  if(!d) return "";
  return d.toLocaleDateString("en-GB",{day:"2-digit",month:"short"});
}

function setDelta(id, current, previous, invert=false){
  const el = document.getElementById(id);
  if(!el) return;
  if(!previous||!isFinite(previous)||previous===0){el.textContent="";return;}
  const pct  = ((current-previous)/Math.abs(previous))*100;
  const isUp = pct>0;
  const isGood = invert ? !isUp : isUp;
  const arrow = pct>0?"▲":(pct<0?"▼":"●");
  el.className = "kpi-delta "+(Math.abs(pct)<0.01?"flat":(isGood?"up":"down"));
  el.textContent = `${arrow} ${Math.abs(pct).toFixed(1)}% مقارنة بالفترة السابقة`;
}

const sumCol = (rows,idx) => idx==null?0:rows.reduce((s,r)=>s+num(r[idx]),0);

/* ============================================================
   Load Data
============================================================ */
async function loadData(){
  showSkeleton(true);
  try{
    const res = await fetch(SHEET_URL+"&_="+Date.now());
    if(!res.ok) throw new Error("HTTP "+res.status);
    const text = await res.text();
    const parsed = Papa.parse(text,{skipEmptyLines:true});
    RAW_ROWS = parsed.data.filter(r=>r[COL.day]&&/\d{1,2}\/[A-Za-z]+\/\d{4}/.test(r[COL.day]));
    const ts = "آخر تحديث: "+new Date().toLocaleString("ar-EG")+" — "+RAW_ROWS.length+" صف";
    document.getElementById("lastUpdate").textContent     = ts;
    const sb = document.getElementById("lastUpdateSidebar");
    if(sb) sb.textContent = ts;
    if(RAW_ROWS.length===0) console.warn("⚠️ لا توجد صفوف");
    render();
  }catch(e){
    console.error("❌ فشل:",e);
    const msg = "❌ فشل: "+e.message;
    document.getElementById("lastUpdate").textContent = msg;
  }finally{
    showSkeleton(false);
  }
}

function showSkeleton(on){
  const el = document.getElementById("skeletonOverlay");
  if(!el) return;
  el.classList.toggle("visible", on);
}

/* ============================================================
   Filtering & Period
============================================================ */
function getSortedRows(){
  return RAW_ROWS.slice().sort((a,b)=>parseRowDate(a[COL.day])-parseRowDate(b[COL.day]));
}

function getFilteredRows(){
  const rows = getSortedRows();
  if(!rows.length) return [];
  if(CURRENT_PERIOD==="all") return rows;

  const lastDate = parseRowDate(rows[rows.length-1][COL.day])||new Date();

  if(CURRENT_PERIOD==="custom"){
    const f=document.getElementById("dateFrom").value;
    const t=document.getElementById("dateTo").value;
    if(!f||!t) return rows;
    const from=new Date(f), to=new Date(t);
    return rows.filter(r=>{const d=parseRowDate(r[COL.day]);return d>=from&&d<=to;});
  }

  const daysMap={day:1,week:7,month:30,quarter:90};
  const days=daysMap[CURRENT_PERIOD]||30;
  const cutoff=new Date(lastDate);
  cutoff.setDate(lastDate.getDate()-days+1);
  return rows.filter(r=>parseRowDate(r[COL.day])>=cutoff);
}

function getPreviousPeriodRows(currentRows){
  if(!currentRows.length) return [];
  const allSorted=getSortedRows();
  const firstCur=parseRowDate(currentRows[0][COL.day]);
  const lastCur =parseRowDate(currentRows[currentRows.length-1][COL.day]);
  const span=Math.max(1,Math.round((lastCur-firstCur)/86400000)+1);
  const prevEnd=new Date(firstCur); prevEnd.setDate(firstCur.getDate()-1);
  const prevStart=new Date(prevEnd); prevStart.setDate(prevEnd.getDate()-span+1);
  return allSorted.filter(r=>{const d=parseRowDate(r[COL.day]);return d>=prevStart&&d<=prevEnd;});
}

/* ============================================================
   Group By
============================================================ */
function groupRows(rows,mode){
  if(mode==="day") return rows.map(r=>({label:r[COL.day],rows:[r]}));
  const groups=new Map();
  for(const r of rows){
    const d=parseRowDate(r[COL.day]); if(!d) continue;
    let key;
    if(mode==="week"){
      const tmp=new Date(d);
      const dow=(tmp.getDay()+6)%7;
      tmp.setDate(tmp.getDate()-dow);
      key=tmp.toISOString().slice(0,10);
    }else{
      key=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
    }
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(r);
  }
  return [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([key,rs])=>{
      let label=key;
      if(mode==="week"){const d=new Date(key);label="أسبوع "+fmtDateShort(d);}
      else{const[y,m]=key.split("-");label=new Date(+y,+m-1,1).toLocaleDateString("en-GB",{month:"short",year:"2-digit"});}
      return{label,rows:rs};
    });
}

/* ============================================================
   Active Channels (with Top-N filter)
============================================================ */
function getDisplayChannels(channelTotals){
  let names = Object.keys(channelTotals).filter(n=>ACTIVE_CHANNELS.has(n));
  if(TOP_N!=="all"){
    const n=parseInt(TOP_N);
    names = names
      .slice()
      .sort((a,b)=>channelTotals[b].revenue - channelTotals[a].revenue)
      .slice(0,n);
  }
  return names;
}

/* ============================================================
   Render Master
============================================================ */
function render(){
  const rows=getFilteredRows();
  const prevRows=getPreviousPeriodRows(rows);
  if(CURRENT_TAB==="overview")  renderOverview(rows,prevRows);
  if(CURRENT_TAB==="marketing") renderMarketing(rows);
  if(CURRENT_TAB==="funnel")    renderFunnel(rows);
}

/* ============================================================
   TAB 1 — Overview
============================================================ */
function renderOverview(rows,prevRows){
  const totals=computeTotals(rows);
  const prev  =computeTotals(prevRows);

  document.getElementById("kpiSpend").textContent   = fmtMoney(totals.spend);
  document.getElementById("kpiRevenue").textContent = fmtMoney(totals.revenue);
  document.getElementById("kpiRoas").textContent    = totals.roas.toFixed(2)+"x";
  document.getElementById("kpiOrders").textContent  = fmtMoney(totals.orders);
  document.getElementById("kpiAov").textContent     = fmtMoney(totals.aov);
  document.getElementById("kpiCr").textContent      = (totals.cr*100).toFixed(2)+"%";
  document.getElementById("kpiCtr").textContent     = (totals.ctr*100).toFixed(2)+"%";
  document.getElementById("kpiCpo").textContent     = fmtMoney(totals.cpo);

  setDelta("kpiSpendDelta",   totals.spend,   prev.spend,   true);
  setDelta("kpiRevenueDelta", totals.revenue, prev.revenue, false);
  setDelta("kpiRoasDelta",    totals.roas,    prev.roas,    false);
  setDelta("kpiOrdersDelta",  totals.orders,  prev.orders,  false);
  setDelta("kpiAovDelta",     totals.aov,     prev.aov,     false);
  setDelta("kpiCrDelta",      totals.cr,      prev.cr,      false);
  setDelta("kpiCtrDelta",     totals.ctr,     prev.ctr,     false);
  setDelta("kpiCpoDelta",     totals.cpo,     prev.cpo,     true);

  // ---- Trend Chart (metric-aware + compare) ----
  const groups    = groupRows(rows, GROUP_BY);
  const prevGroups= COMPARE_ON ? groupRows(prevRows, GROUP_BY) : [];
  const labels    = groups.map(g=>g.label);
  const datasets  = buildTrendDatasets(groups, prevGroups, labels);

  drawChart("trendChart","line",{labels,datasets});

  // ---- Donuts ----
  const channelTotals = computeChannelTotals(rows);
  const chNames = getDisplayChannels(channelTotals);
  const colors  = chNames.map(n=>COL.channels[n].color);

  drawChart("spendDonut","doughnut",{
    labels:chNames,
    datasets:[{data:chNames.map(n=>channelTotals[n].spend),backgroundColor:colors,borderWidth:0,hoverOffset:6}]
  });
  drawChart("revenueDonut","doughnut",{
    labels:chNames,
    datasets:[{data:chNames.map(n=>channelTotals[n].revenue),backgroundColor:colors,borderWidth:0,hoverOffset:6}]
  });

  // ---- ROAS Trend + compare ----
  const roasSeries = groups.map(g=>{
    const s=sumCol(g.rows,COL.totalSpend), r=sumCol(g.rows,COL.totalRevenue);
    return s?+(r/s).toFixed(2):0;
  });
  const roasDatasets = [{
    label:"ROAS",data:roasSeries,
    borderColor:"#8b5cf6",backgroundColor:"rgba(139,92,246,.15)",
    tension:.35,fill:true,pointRadius:3
  }];
  if(COMPARE_ON && prevGroups.length){
    const prevRoasSeries = prevGroups.map(g=>{
      const s=sumCol(g.rows,COL.totalSpend), r=sumCol(g.rows,COL.totalRevenue);
      return s?+(r/s).toFixed(2):0;
    });
    roasDatasets.push({
      label:"ROAS (سابق)",data:prevRoasSeries,
      borderColor:"rgba(139,92,246,.45)",backgroundColor:"transparent",
      borderDash:[5,4],tension:.35,fill:false,pointRadius:2
    });
  }
  drawChart("roasTrend","line",{labels,datasets:roasDatasets});
}

/* Build trend datasets based on selected metric */
function buildTrendDatasets(groups, prevGroups, labels){
  const spendS  = groups.map(g=>sumCol(g.rows,COL.totalSpend));
  const revS    = groups.map(g=>sumCol(g.rows,COL.totalRevenue));
  const roasS   = groups.map(g=>{const s=sumCol(g.rows,COL.totalSpend),r=sumCol(g.rows,COL.totalRevenue);return s?+(r/s).toFixed(2):0;});
  const ordersS = groups.map(g=>sumCol(g.rows,COL.orders));

  const prevSpendS  = prevGroups.map(g=>sumCol(g.rows,COL.totalSpend));
  const prevRevS    = prevGroups.map(g=>sumCol(g.rows,COL.totalRevenue));
  const prevRoasS   = prevGroups.map(g=>{const s=sumCol(g.rows,COL.totalSpend),r=sumCol(g.rows,COL.totalRevenue);return s?+(r/s).toFixed(2):0;});
  const prevOrdersS = prevGroups.map(g=>sumCol(g.rows,COL.orders));

  const addPrev = (data, color, name) => COMPARE_ON && prevGroups.length ? [{
    label:name+" (سابق)",data,
    borderColor:color.replace("1)","0.45)").replace("#","rgba(").replace(/^rgba\(([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i,(_,r,g,b)=>`rgba(${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)}`)+",0.45)",
    backgroundColor:"transparent",
    borderDash:[5,4],tension:.35,fill:false,pointRadius:2
  }] : [];

  /* helper: hex to rgba */
  const hex2rgba=(hex,a=1)=>{
    const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  };

  const prevLine=(data,hex,name)=> COMPARE_ON&&prevGroups.length ? [{
    label:name+" (سابق)",data,
    borderColor:hex2rgba(hex,.4),backgroundColor:"transparent",
    borderDash:[5,4],tension:.35,fill:false,pointRadius:2
  }] : [];

  if(TREND_METRIC==="spend") return [
    {label:"الإنفاق",data:spendS,borderColor:"#ef4444",backgroundColor:"rgba(239,68,68,.12)",tension:.35,fill:true,pointRadius:3},
    ...prevLine(prevSpendS,"#ef4444","الإنفاق")
  ];
  if(TREND_METRIC==="revenue") return [
    {label:"الإيرادات",data:revS,borderColor:"#10b981",backgroundColor:"rgba(16,185,129,.12)",tension:.35,fill:true,pointRadius:3},
    ...prevLine(prevRevS,"#10b981","الإيرادات")
  ];
  if(TREND_METRIC==="roas") return [
    {label:"ROAS",data:roasS,borderColor:"#8b5cf6",backgroundColor:"rgba(139,92,246,.12)",tension:.35,fill:true,pointRadius:3},
    ...prevLine(prevRoasS,"#8b5cf6","ROAS")
  ];
  if(TREND_METRIC==="orders") return [
    {label:"الطلبات",data:ordersS,borderColor:"#f97316",backgroundColor:"rgba(249,115,22,.12)",tension:.35,fill:true,pointRadius:3},
    ...prevLine(prevOrdersS,"#f97316","الطلبات")
  ];
  // default: both spend + revenue
  return [
    {label:"الإنفاق",data:spendS,borderColor:"#ef4444",backgroundColor:"rgba(239,68,68,.12)",tension:.35,fill:true,pointRadius:3,pointBackgroundColor:"#ef4444"},
    {label:"الإيرادات",data:revS,borderColor:"#10b981",backgroundColor:"rgba(16,185,129,.12)",tension:.35,fill:true,pointRadius:3,pointBackgroundColor:"#10b981"},
    ...prevLine(prevSpendS,"#ef4444","الإنفاق"),
    ...prevLine(prevRevS,"#10b981","الإيرادات")
  ];
}

/* ============================================================
   TAB 2 — Marketing
============================================================ */
function renderMarketing(rows){
  const channelTotals=computeChannelTotals(rows);
  const chNames = getDisplayChannels(channelTotals);
  const colors  = chNames.map(n=>COL.channels[n].color);

  drawChart("channelComboChart","bar",{
    labels:chNames,
    datasets:[
      {label:"الإنفاق",  data:chNames.map(n=>channelTotals[n].spend),  backgroundColor:"#ef4444",borderRadius:6},
      {label:"الإيرادات",data:chNames.map(n=>channelTotals[n].revenue),backgroundColor:"#10b981",borderRadius:6}
    ]
  });

  drawChart("roasChannelChart","bar",{
    labels:chNames,
    datasets:[{label:"ROAS",data:chNames.map(n=>+channelTotals[n].roas.toFixed(2)),backgroundColor:colors,borderRadius:6}]
  },{indexAxis:"y"});

  drawChart("ordersChannelChart","bar",{
    labels:chNames,
    datasets:[{label:"الطلبات",data:chNames.map(n=>channelTotals[n].trans),backgroundColor:"#3b82f6",borderRadius:6}]
  });

  // Scatter: CTR vs CR
  const scatterData=chNames.map(n=>{
    const c=channelTotals[n];
    const ctr=c.imp?(c.click/c.imp)*100:0;
    const cr =c.click?(c.trans/c.click)*100:0;
    return{x:+ctr.toFixed(2),y:+cr.toFixed(2),label:n};
  });
  drawChart("efficiencyChart","scatter",{
    datasets:scatterData.map((p,i)=>({
      label:p.label,data:[p],
      backgroundColor:colors[i],borderColor:colors[i],
      pointRadius:9,pointHoverRadius:13
    }))
  },{
    scales:{
      x:{title:{display:true,text:"CTR %",color:"#8aa0c2"},ticks:{color:"#8aa0c2"},grid:{color:"#1b2640"}},
      y:{title:{display:true,text:"CR %", color:"#8aa0c2"},ticks:{color:"#8aa0c2"},grid:{color:"#1b2640"}}
    }
  });

  renderChannelTable(channelTotals, chNames);
}

/* ============================================================
   Channel Table (with sort + search)
============================================================ */
let CHANNEL_TABLE_DATA = [];

function renderChannelTable(channelTotals, chNames){
  CHANNEL_TABLE_DATA = chNames.map(n=>{
    const c=channelTotals[n];
    const ctr=c.imp?(c.click/c.imp):0;
    const cr =c.click?(c.trans/c.click):0;
    return{name:n,spend:c.spend,imp:c.imp,click:c.click,ctr,trans:c.trans,cr,revenue:c.revenue,roas:c.roas};
  });
  paintChannelTable();
}

function paintChannelTable(){
  const search = (document.getElementById("tableSearch")?.value||"").toLowerCase();
  let data = CHANNEL_TABLE_DATA.filter(r=>r.name.toLowerCase().includes(search));

  if(TABLE_SORT_COL){
    data = data.slice().sort((a,b)=>{
      const av=a[TABLE_SORT_COL], bv=b[TABLE_SORT_COL];
      if(typeof av==="string") return TABLE_SORT_DIR*av.localeCompare(bv);
      return TABLE_SORT_DIR*(av-bv);
    });
  }

  const tbody = document.getElementById("channelTableBody");
  if(!tbody) return;

  tbody.innerHTML = data.map(r=>{
    let status="warn",label="متوسط";
    if(r.roas>=5){status="good";label="ممتاز";}
    else if(r.roas<2){status="bad";label="ضعيف";}
    return `<tr>
      <td class="sticky-col"><span style="color:${COL.channels[r.name]?.color||'#fff'}">●</span> <strong>${r.name}</strong></td>
      <td>${fmtMoney(r.spend)}</td>
      <td>${fmtMoney(r.imp)}</td>
      <td>${fmtMoney(r.click)}</td>
      <td>${(r.ctr*100).toFixed(2)}%</td>
      <td>${fmtMoney(r.trans)}</td>
      <td>${(r.cr*100).toFixed(2)}%</td>
      <td>${fmtMoney(r.revenue)}</td>
      <td><strong>${r.roas.toFixed(2)}x</strong></td>
      <td><span class="status-pill ${status}">${label}</span></td>
    </tr>`;
  }).join("");
}

/* ============================================================
   TAB 3 — Funnel
============================================================ */
function renderFunnel(rows){
  const totals=computeTotals(rows);
  const traffic=sumCol(rows,COL.webTraffic);
  const clicks =sumCol(rows,COL.click);

  document.getElementById("fnTraffic").textContent = fmtMoney(traffic);
  document.getElementById("fnOrders").textContent  = fmtMoney(totals.orders);
  document.getElementById("fnCr").textContent      = (totals.cr*100).toFixed(2)+"%";
  document.getElementById("fnAov").textContent     = fmtMoney(totals.aov);

  drawChart("funnelChart","bar",{
    labels:["الزيارات","النقرات","الطلبات"],
    datasets:[{label:"عدد",data:[traffic,clicks,totals.orders],
      backgroundColor:["#3b82f6","#8b5cf6","#10b981"],borderRadius:8}]
  },{indexAxis:"y",plugins:{legend:{display:false}}});

  const groups=groupRows(rows,GROUP_BY);
  drawChart("ordersTrend","line",{
    labels:groups.map(g=>g.label),
    datasets:[{
      label:"الطلبات",data:groups.map(g=>sumCol(g.rows,COL.orders)),
      borderColor:"#f97316",backgroundColor:"rgba(249,115,22,.15)",
      tension:.35,fill:true,pointRadius:3
    }]
  });
}

/* ============================================================
   Computations
============================================================ */
function computeTotals(rows){
  const spend  =sumCol(rows,COL.totalSpend);
  const revenue=sumCol(rows,COL.totalRevenue);
  const orders =sumCol(rows,COL.orders);
  const imp    =sumCol(rows,COL.imp);
  const clicks =sumCol(rows,COL.click);
  return{spend,revenue,orders,
    roas:spend?revenue/spend:0,
    aov :orders?revenue/orders:0,
    cpo :orders?spend/orders:0,
    cr  :clicks?orders/clicks:0,
    ctr :imp?clicks/imp:0};
}

function computeChannelTotals(rows){
  const out={};
  for(const[name,c]of Object.entries(COL.channels)){
    const spend  =sumCol(rows,c.spend);
    const revenue=sumCol(rows,c.revenue);
    out[name]={spend,revenue,
      imp  :sumCol(rows,c.imp),
      click:sumCol(rows,c.click),
      trans:sumCol(rows,c.trans),
      roas :spend?revenue/spend:0};
  }
  return out;
}

/* ============================================================
   Chart Drawer
============================================================ */
function drawChart(id, type, data, extraOpts={}){
  const el=document.getElementById(id);
  if(!el) return;
  if(CHARTS[id]) CHARTS[id].destroy();

  const isDoughnut=(type==="doughnut"||type==="pie");
  const baseOpts={
    responsive:true,maintainAspectRatio:false,
    animation:{duration:600,easing:"easeOutQuart"},
    plugins:{
      legend:{
        labels:{color:"#94a3b8",font:{family:"Tajawal",size:11},
          boxWidth:10,boxHeight:10,borderRadius:3,padding:14}
      },
      tooltip:{
        backgroundColor:"rgba(8,13,24,.95)",
        borderColor:"rgba(255,255,255,.08)",borderWidth:1,
        titleFont:{family:"Tajawal",size:13},
        bodyFont:{family:"Tajawal",size:12},
        padding:10,cornerRadius:10,
        callbacks:{
          label:ctx=>{
            const v=ctx.parsed.y??ctx.parsed??ctx.raw;
            if(typeof v==="number") return " "+fmtMoney(v);
            return " "+v;
          }
        }
      }
    },
    scales:isDoughnut?{}:{
      x:{ticks:{color:"#6b84b0",font:{family:"Tajawal",size:11},maxRotation:30},grid:{color:"rgba(255,255,255,.04)"}},
      y:{ticks:{color:"#6b84b0",font:{family:"Tajawal",size:11}},          grid:{color:"rgba(255,255,255,.04)"}}
    }
  };

  const opts={...baseOpts,...extraOpts};
  if(extraOpts.scales)  opts.scales ={...baseOpts.scales, ...extraOpts.scales};
  if(extraOpts.plugins) opts.plugins={...baseOpts.plugins,...extraOpts.plugins};

  CHARTS[id]=new Chart(el.getContext("2d"),{type,data,options:opts});
}

/* ============================================================
   Channel Chips
============================================================ */
function buildChannelChips(){
  const wrap=document.getElementById("channelChips");
  if(!wrap) return;
  wrap.innerHTML=Object.keys(COL.channels).map(n=>
    `<button class="chip active" data-ch="${n}" style="--cc:${COL.channels[n].color}">${n}</button>`
  ).join("");

  wrap.querySelectorAll(".chip").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const ch=btn.dataset.ch;
      btn.classList.toggle("active");
      ACTIVE_CHANNELS[btn.classList.contains("active")?"add":"delete"](ch);
      render();
    });
  });
}

/* ============================================================
   Tab Switching
============================================================ */
function switchTab(tab){
  CURRENT_TAB=tab;

  // Desktop nav
  document.querySelectorAll(".nav-item").forEach(b=>
    b.classList.toggle("active",b.dataset.tab===tab));

  // Bottom nav
  document.querySelectorAll(".bnav-item").forEach(b=>
    b.classList.toggle("active",b.dataset.tab===tab));

  // Content
  document.querySelectorAll(".tab-content").forEach(s=>
    s.classList.toggle("active",s.dataset.tabContent===tab));

  const titles={
    overview: ["نظرة عامة على الأداء","ملخص شامل لأداء التسويق والمبيعات"],
    marketing:["أداء التسويق الرقمي","تحليل تفصيلي لكل قناة تسويقية"],
    funnel:   ["قمع التحويل","رحلة الزائر من الزيارة إلى الطلب"]
  };
  document.getElementById("pageTitle").textContent    = titles[tab][0];
  document.getElementById("pageSubtitle").textContent = titles[tab][1];

  render();
}

/* ============================================================
   Sidebar (mobile)
============================================================ */
function toggleSidebar(force){
  const sidebar  = document.getElementById("sidebar");
  const overlay  = document.getElementById("sidebarOverlay");
  const hamburger= document.getElementById("hamburgerBtn");
  const isOpen   = sidebar.classList.contains("open");
  const open     = force!==undefined ? force : !isOpen;

  sidebar.classList.toggle("open",open);
  overlay.classList.toggle("visible",open);
  hamburger.classList.toggle("open",open);
  hamburger.setAttribute("aria-expanded",String(open));
  document.body.style.overflow = open?"hidden":"";
}

/* ============================================================
   Export (html2canvas)
============================================================ */
function doExport(){
  const btn=document.getElementById("exportBtn");
  btn.classList.add("loading");
  const target=document.getElementById("mainContent");
  html2canvas(target,{
    backgroundColor:"#080d18",
    scale:1.5,
    useCORS:true,
    logging:false
  }).then(canvas=>{
    const link=document.createElement("a");
    link.download="joli-dashboard-"+Date.now()+".png";
    link.href=canvas.toDataURL("image/png");
    link.click();
  }).catch(e=>console.error("Export failed:",e))
    .finally(()=>btn.classList.remove("loading"));
}

/* ============================================================
   Wire Events
============================================================ */
function wireEvents(){
  /* Desktop nav */
  document.querySelectorAll(".nav-item").forEach(b=>
    b.addEventListener("click",()=>{switchTab(b.dataset.tab);toggleSidebar(false);}));

  /* Mobile bottom nav */
  document.querySelectorAll(".bnav-item").forEach(b=>
    b.addEventListener("click",()=>switchTab(b.dataset.tab)));

  /* Hamburger */
  document.getElementById("hamburgerBtn")
    ?.addEventListener("click",()=>toggleSidebar());

  /* Sidebar overlay */
  document.getElementById("sidebarOverlay")
    ?.addEventListener("click",()=>toggleSidebar(false));

  /* Period buttons */
  document.querySelectorAll(".period-btn").forEach(b=>{
    b.addEventListener("click",()=>{
      document.querySelectorAll(".period-btn").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      CURRENT_PERIOD=b.dataset.period;
      document.getElementById("dateRangeWrap").style.display=
        CURRENT_PERIOD==="custom"?"flex":"none";
      render();
    });
  });

  /* Custom dates */
  document.getElementById("dateFrom")?.addEventListener("change",render);
  document.getElementById("dateTo")  ?.addEventListener("change",render);

  /* Group by */
  document.getElementById("groupBy")?.addEventListener("change",e=>{
    GROUP_BY=e.target.value; render();
  });

  /* Compare toggle */
  document.getElementById("compareToggle")?.addEventListener("change",e=>{
    COMPARE_ON=e.target.checked; render();
  });

  /* Trend metric */
  document.getElementById("trendMetric")?.addEventListener("change",e=>{
    TREND_METRIC=e.target.value; render();
  });

  /* Top N */
  document.querySelectorAll(".topn-btn").forEach(b=>{
    b.addEventListener("click",()=>{
      document.querySelectorAll(".topn-btn").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      TOP_N=b.dataset.topn;
      render();
    });
  });

  /* Refresh */
  document.getElementById("refreshBtn")?.addEventListener("click",loadData);

  /* Export */
  document.getElementById("exportBtn")?.addEventListener("click",doExport);

  /* Table search */
  document.getElementById("tableSearch")?.addEventListener("input",paintChannelTable);

  /* Table sort */
  document.querySelectorAll("th.sortable").forEach(th=>{
    th.addEventListener("click",()=>{
      const col=th.dataset.sort;
      if(TABLE_SORT_COL===col){
        TABLE_SORT_DIR*=-1;
      }else{
        TABLE_SORT_COL=col;
        TABLE_SORT_DIR=-1; // desc by default
      }
      document.querySelectorAll("th.sortable").forEach(t=>{
        t.classList.remove("sorted-asc","sorted-desc");
      });
      th.classList.add(TABLE_SORT_DIR===1?"sorted-asc":"sorted-desc");
      paintChannelTable();
    });
  });
}

/* ============================================================
   Init
============================================================ */
buildChannelChips();
wireEvents();
loadData();
