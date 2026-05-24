/* ============================================================
   Joli Monitoring v3 — app.js
   Light brand theme + Insights/Diagnostics tab
============================================================ */

const SHEET_ID  = "18pvf_fuBjtBdYX4CAFgFCAmaYIRLpVGzsG_0FX0LqfY";
const SHEET_GID = "1602116591";

// Strategy: export endpoint bypasses in-sheet filter views → returns ALL rows
// gviz respects filter views so only returns visible (current-month) rows
const SHEET_EXPORT     = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const SHEET_EXPORT_0   = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
const SHEET_GVIZ_FULL  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}&headers=1`;
const SHEET_GVIZ_SEL   = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}&tq=${encodeURIComponent("select *")}`;
// Published-to-web URL (bypasses filters & auth, works if sheet is published)
const SHEET_PUB        = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/pub?output=csv&gid=${SHEET_GID}`;

// Keep legacy alias used elsewhere
const SHEET_URL        = SHEET_EXPORT;
const SHEET_URL_NOGID  = SHEET_EXPORT_0;

const COL = {
  year:1,month:2,day:3,
  webTraffic:5,imp:6,click:7,ctr:8,
  orders:9,cr:10,costOrder:11,aov:12,
  totalSpend:14,totalRevenue:15,accountRevenue:16,roas:17,
  channels:{
    "Google Ads":  {spend:19,imp:20,click:21,trans:22,revenue:23,roas:24,color:"#2563EB"},
    "Snapchat":    {spend:26,imp:27,click:28,trans:29,revenue:30,roas:31,color:"#D97706"},
    "Meta":        {spend:33,imp:34,click:35,trans:36,revenue:37,roas:38,color:"#1877f2"},
    "TikTok":      {spend:40,imp:41,click:42,trans:43,revenue:44,roas:45,color:"#F0006A"},
    "X":           {spend:47,imp:null,click:null,trans:null,revenue:48,roas:49,color:"#7C3AED"},
    "Influencer":  {spend:51,imp:52,click:53,trans:54,revenue:55,roas:56,color:"#00A86B"},
    "WhatsApp":    {spend:58,imp:59,click:60,trans:61,revenue:62,roas:63,color:"#0891B2"}
  }
};

/* State */
let RAW_ROWS       = [];
let ACTIVE_CHANNELS= new Set(Object.keys(COL.channels));
let CHARTS         = {};
let CURRENT_TAB    = "overview";
let CURRENT_PERIOD = "all";
let GROUP_BY       = "day";
let COMPARE_ON     = false;
let TREND_METRIC   = "both";
let TOP_N          = "all";
let TABLE_SORT_COL = null;
let TABLE_SORT_DIR = -1;
let CHANNEL_TABLE_DATA = [];
let FILTER_OPEN = false;

/* ============ Helpers ============ */
const num = v => {
  if(v==null||v==="") return 0;
  const n=parseFloat(String(v).replace(/[,٬\s%"$]/g,""));
  return isNaN(n)?0:n;
};
const fmt      = (n,d=0) => Number(n||0).toLocaleString("en-US",{maximumFractionDigits:d});
const fmtMoney = n => fmt(n,0);

/* parseRowDate — supports multiple date formats from Google Sheets:
   dd/Mon/yyyy  →  01/Jan/2026
   dd/mm/yyyy   →  01/01/2026
   yyyy-mm-dd   →  2026-01-01
   mm/dd/yyyy   →  01/15/2026 (US format)
   d Mon yyyy   →  1 Jan 2026
*/
function parseRowDate(str){
  if(!str||str.trim()==="") return null;
  const s=String(str).trim();
  const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11,
           جان:0,فبر:1,مار:2,أبر:3,ماي:4,يون:5,يول:6,أغس:7,سبت:8,أكت:9,نوف:10,ديس:11};

  // Format: 01/Jan/2026 or 1/Jan/2026
  let m=s.match(/^(\d{1,2})\/([A-Za-z]+)\/(\d{4})$/);
  if(m) return new Date(+m[3], M[m[2]]??0, +m[1]);

  // Format: 2026-01-01 (ISO)
  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m) return new Date(+m[1], +m[2]-1, +m[3]);

  // Format: 01/01/2026 (dd/mm/yyyy)
  m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m){
    const day=+m[1], mon=+m[2], yr=+m[3];
    // Distinguish dd/mm vs mm/dd: if day > 12, must be dd/mm
    if(day>12) return new Date(yr, mon-1, day);
    // Default assume dd/mm/yyyy (non-US)
    return new Date(yr, mon-1, day);
  }

  // Format: 1 Jan 2026 or 01-Jan-2026
  m=s.match(/^(\d{1,2})[\s\-\/]([A-Za-z]+)[\s\-\/](\d{4})$/);
  if(m) return new Date(+m[3], M[m[2]]??0, +m[1]);

  // Let the browser try as a last resort
  const d=new Date(s);
  return isNaN(d.getTime())?null:d;
}

/* Detect if a cell value looks like any recognizable date */
function looksLikeDate(v){
  if(!v||v.trim()==="") return false;
  const s=String(v).trim();
  return /\d{1,2}\/[A-Za-z]+\/\d{4}/.test(s) ||  // dd/Mon/yyyy
         /\d{4}-\d{1,2}-\d{1,2}/.test(s)     ||  // ISO
         /\d{1,2}\/\d{1,2}\/\d{4}/.test(s)   ||  // dd/mm/yyyy
         /\d{1,2}[\s\-][A-Za-z]{3}[\s\-]\d{4}/.test(s); // d Mon yyyy
}
function fmtDateShort(d){if(!d)return "";return d.toLocaleDateString("en-GB",{day:"2-digit",month:"short"})}

function setDelta(id,cur,prev,invert=false){
  const el=document.getElementById(id);
  if(!el) return;
  if(!prev||!isFinite(prev)||prev===0){el.textContent="";return;}
  const pct=((cur-prev)/Math.abs(prev))*100;
  const isGood=invert?(pct<0):(pct>0);
  const arrow=pct>0?"▲":(pct<0?"▼":"●");
  el.className="kpi-delta "+(Math.abs(pct)<0.01?"flat":(isGood?"up":"down"));
  el.textContent=`${arrow} ${Math.abs(pct).toFixed(1)}% مقارنة بالفترة السابقة`;
}

const sumCol=(rows,idx)=>idx==null?0:rows.reduce((s,r)=>s+num(r[idx]),0);

/* ============ Load ============ */
async function loadData(){
  showSkeleton(true);
  console.group("🔍 Joli Dashboard — تشخيص البيانات");

  // We try multiple URLs in priority order.
  // export?format=csv bypasses Google Sheets filter views → returns ALL rows.
  // gviz?select * respects filter views → may return only visible/current-month rows.
  const urlsToTry = [
    { label:"export GID",       url: SHEET_EXPORT    },
    { label:"export GID=0",     url: SHEET_EXPORT_0  },
    { label:"pub output=csv",   url: SHEET_PUB       },
    { label:"gviz no-tq",       url: SHEET_GVIZ_FULL },
    { label:"gviz select *",    url: SHEET_GVIZ_SEL  },
  ];

  let bestRows = [];
  let succeeded = false;

  for(const {label, url} of urlsToTry){
    try{
      console.log(`⏳ جاري جلب: ${label}`);
      const text  = await fetchCSV(url);
      const parsed = Papa.parse(text, {skipEmptyLines:true});
      console.log(`  ← إجمالي الصفوف الخام: ${parsed.data.length}`);

      // Log sample of column D for the first few rows
      const sample = parsed.data.slice(0, 5).map(r =>
        `[${label}] col_year=${r[COL.year]} | col_month=${r[COL.month]} | col_day=${r[COL.day]}`
      );
      sample.forEach(s => console.log(s));

      // Keep rows that have a recognizable date in COL.day
      const rows = parsed.data.filter(r => r[COL.day] && looksLikeDate(r[COL.day]));
      console.log(`  ← صفوف بعد فلترة التاريخ: ${rows.length}`);

      if(rows.length > bestRows.length){
        bestRows = rows;
        succeeded = true;
        console.log(`  ✅ أفضل حتى الآن: ${rows.length} صف`);
      }

      // If we already have ≥ 50 rows, stop trying further URLs
      if(bestRows.length >= 50) break;

    }catch(err){
      console.warn(`  ⚠️ فشل ${label}:`, err.message);
    }
  }

  RAW_ROWS = bestRows;

  // Date range diagnostic
  if(RAW_ROWS.length > 0){
    const sorted = RAW_ROWS.slice().sort((a,b)=>parseRowDate(a[COL.day])-parseRowDate(b[COL.day]));
    const firstDate = parseRowDate(sorted[0][COL.day]);
    const lastDate  = parseRowDate(sorted[sorted.length-1][COL.day]);
    console.log("📅 نطاق التواريخ:", firstDate?.toLocaleDateString("ar-EG"), "←→", lastDate?.toLocaleDateString("ar-EG"));
    console.log("📊 إجمالي الصفوف المحملة:", RAW_ROWS.length);
  }
  console.groupEnd();

  const ts = "آخر تحديث: " + new Date().toLocaleString("ar-EG") + " — " + RAW_ROWS.length + " صف";
  document.getElementById("lastUpdate").textContent = ts;
  const sb = document.getElementById("lastUpdateSidebar");
  if(sb) sb.textContent = ts;

  if(RAW_ROWS.length === 0) showDataWarning();

  showSkeleton(false);
  render();
}

async function fetchCSV(url){
  // Add cache-buster without breaking URLs that already have a query string
  const sep = url.includes("?") ? "&" : "?";
  const res  = await fetch(url + sep + "_=" + Date.now(), {cache:"no-store"});
  if(!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}

function showDataWarning(){
  console.warn("⚠️ لا توجد صفوف تحتوي على تواريخ صحيحة.");
  console.warn("تحقق من:");
  console.warn("1- أن عمود التاريخ (COL.day =", COL.day, ") يحتوي على تواريخ");
  console.warn("2- أن الشيت مشارك للعموم (Anyone with link → Viewer)");
  console.warn("3- أن SHEET_GID صحيح — جرب تغييره إلى gid=0 للشيت الأول");
}
function showSkeleton(on){document.getElementById("skeletonOverlay")?.classList.toggle("visible",on)}

/* ============ Filtering ============ */
function getSortedRows(){return RAW_ROWS.slice().sort((a,b)=>parseRowDate(a[COL.day])-parseRowDate(b[COL.day]))}

function getFilteredRows(){
  const rows=getSortedRows();
  if(!rows.length) return [];
  if(CURRENT_PERIOD==="all") return rows;
  const lastDate=parseRowDate(rows[rows.length-1][COL.day])||new Date();
  if(CURRENT_PERIOD==="custom"){
    const f=document.getElementById("dateFrom").value;
    const t=document.getElementById("dateTo").value;
    if(!f||!t) return rows;
    const from=new Date(f),to=new Date(t);
    return rows.filter(r=>{const d=parseRowDate(r[COL.day]);return d>=from&&d<=to;});
  }
  const daysMap={day:1,week:7,month:30,quarter:90};
  const days=daysMap[CURRENT_PERIOD]||30;
  const cutoff=new Date(lastDate);
  cutoff.setDate(lastDate.getDate()-days+1);
  return rows.filter(r=>parseRowDate(r[COL.day])>=cutoff);
}

function getPreviousPeriodRows(cur){
  if(!cur.length) return [];
  const all=getSortedRows();
  const first=parseRowDate(cur[0][COL.day]);
  const last =parseRowDate(cur[cur.length-1][COL.day]);
  const span=Math.max(1,Math.round((last-first)/86400000)+1);
  const pEnd=new Date(first); pEnd.setDate(first.getDate()-1);
  const pSt=new Date(pEnd);   pSt.setDate(pEnd.getDate()-span+1);
  return all.filter(r=>{const d=parseRowDate(r[COL.day]);return d>=pSt&&d<=pEnd;});
}

/* ============ Group ============ */
function groupRows(rows,mode){
  if(mode==="day") return rows.map(r=>({label:r[COL.day],rows:[r]}));
  const groups=new Map();
  for(const r of rows){
    const d=parseRowDate(r[COL.day]);if(!d) continue;
    let key;
    if(mode==="week"){const t=new Date(d);const dow=(t.getDay()+6)%7;t.setDate(t.getDate()-dow);key=t.toISOString().slice(0,10);}
    else{key=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");}
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

/* ============ Active channels ============ */
function getDisplayChannels(ct){
  let names=Object.keys(ct).filter(n=>ACTIVE_CHANNELS.has(n));
  if(TOP_N!=="all"){
    const n=parseInt(TOP_N);
    names=names.slice().sort((a,b)=>ct[b].revenue-ct[a].revenue).slice(0,n);
  }
  return names;
}

/* ============ Render Master ============ */
function render(){
  const rows=getFilteredRows();
  const prev=getPreviousPeriodRows(rows);
  if(CURRENT_TAB==="overview")  renderOverview(rows,prev);
  if(CURRENT_TAB==="marketing") renderMarketing(rows);
  if(CURRENT_TAB==="funnel")    renderFunnel(rows);
  if(CURRENT_TAB==="insights")  renderInsights(rows,prev);
  updateFilterSummary();
}

/* ============ Overview ============ */
function renderOverview(rows,prev){
  const t=computeTotals(rows), p=computeTotals(prev);
  document.getElementById("kpiSpend").textContent   = fmtMoney(t.spend);
  document.getElementById("kpiRevenue").textContent = fmtMoney(t.revenue);
  document.getElementById("kpiRoas").textContent    = t.roas.toFixed(2)+"x";
  document.getElementById("kpiOrders").textContent  = fmtMoney(t.orders);
  document.getElementById("kpiAov").textContent     = fmtMoney(t.aov);
  document.getElementById("kpiCr").textContent      = (t.cr*100).toFixed(2)+"%";
  document.getElementById("kpiCtr").textContent     = (t.ctr*100).toFixed(2)+"%";
  document.getElementById("kpiCpo").textContent     = fmtMoney(t.cpo);
  setDelta("kpiSpendDelta",   t.spend,   p.spend,   true);
  setDelta("kpiRevenueDelta", t.revenue, p.revenue, false);
  setDelta("kpiRoasDelta",    t.roas,    p.roas,    false);
  setDelta("kpiOrdersDelta",  t.orders,  p.orders,  false);
  setDelta("kpiAovDelta",     t.aov,     p.aov,     false);
  setDelta("kpiCrDelta",      t.cr,      p.cr,      false);
  setDelta("kpiCtrDelta",     t.ctr,     p.ctr,     false);
  setDelta("kpiCpoDelta",     t.cpo,     p.cpo,     true);

  const groups=groupRows(rows,GROUP_BY);
  const prevGroups=COMPARE_ON?groupRows(prev,GROUP_BY):[];
  const labels=groups.map(g=>g.label);
  drawChart("trendChart","line",{labels,datasets:buildTrendDatasets(groups,prevGroups)});

  const ct=computeChannelTotals(rows);
  const ch=getDisplayChannels(ct);
  const colors=ch.map(n=>COL.channels[n].color);
  drawChart("spendDonut","doughnut",{labels:ch,datasets:[{data:ch.map(n=>ct[n].spend),backgroundColor:colors,borderWidth:0,hoverOffset:6}]});
  drawChart("revenueDonut","doughnut",{labels:ch,datasets:[{data:ch.map(n=>ct[n].revenue),backgroundColor:colors,borderWidth:0,hoverOffset:6}]});

  const roasS=groups.map(g=>{const s=sumCol(g.rows,COL.totalSpend),r=sumCol(g.rows,COL.totalRevenue);return s?+(r/s).toFixed(2):0;});
  const roasDS=[{label:"ROAS",data:roasS,borderColor:"#7C3AED",backgroundColor:"rgba(124,58,237,.1)",tension:.35,fill:true,pointRadius:3}];
  if(COMPARE_ON&&prevGroups.length){
    const pr=prevGroups.map(g=>{const s=sumCol(g.rows,COL.totalSpend),r=sumCol(g.rows,COL.totalRevenue);return s?+(r/s).toFixed(2):0;});
    roasDS.push({label:"ROAS (سابق)",data:pr,borderColor:"rgba(124,58,237,.4)",backgroundColor:"transparent",borderDash:[5,4],tension:.35,fill:false,pointRadius:2});
  }
  drawChart("roasTrend","line",{labels,datasets:roasDS});
}

function buildTrendDatasets(groups,prevGroups){
  const h2r=(hex,a)=>{const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return `rgba(${r},${g},${b},${a})`;};
  const prev=(d,hex,n)=>COMPARE_ON&&prevGroups.length?[{label:n+" (سابق)",data:d,borderColor:h2r(hex,.4),backgroundColor:"transparent",borderDash:[5,4],tension:.35,fill:false,pointRadius:2}]:[];

  const spendS  =groups.map(g=>sumCol(g.rows,COL.totalSpend));
  const revS    =groups.map(g=>sumCol(g.rows,COL.totalRevenue));
  const roasS   =groups.map(g=>{const s=sumCol(g.rows,COL.totalSpend),r=sumCol(g.rows,COL.totalRevenue);return s?+(r/s).toFixed(2):0;});
  const ordersS =groups.map(g=>sumCol(g.rows,COL.orders));
  const pSpend  =prevGroups.map(g=>sumCol(g.rows,COL.totalSpend));
  const pRev    =prevGroups.map(g=>sumCol(g.rows,COL.totalRevenue));
  const pRoas   =prevGroups.map(g=>{const s=sumCol(g.rows,COL.totalSpend),r=sumCol(g.rows,COL.totalRevenue);return s?+(r/s).toFixed(2):0;});
  const pOrders =prevGroups.map(g=>sumCol(g.rows,COL.orders));

  if(TREND_METRIC==="spend")   return [{label:"الإنفاق",   data:spendS, borderColor:"#F0006A",backgroundColor:"rgba(240,0,106,.1)",tension:.35,fill:true,pointRadius:3},...prev(pSpend,"#F0006A","الإنفاق")];
  if(TREND_METRIC==="revenue") return [{label:"الإيرادات", data:revS,   borderColor:"#00A86B",backgroundColor:"rgba(0,168,107,.1)",tension:.35,fill:true,pointRadius:3},...prev(pRev,"#00A86B","الإيرادات")];
  if(TREND_METRIC==="roas")    return [{label:"ROAS",       data:roasS,  borderColor:"#7C3AED",backgroundColor:"rgba(124,58,237,.1)",tension:.35,fill:true,pointRadius:3},...prev(pRoas,"#7C3AED","ROAS")];
  if(TREND_METRIC==="orders")  return [{label:"الطلبات",   data:ordersS,borderColor:"#EA580C",backgroundColor:"rgba(234,88,12,.1)",tension:.35,fill:true,pointRadius:3},...prev(pOrders,"#EA580C","الطلبات")];
  return [
    {label:"الإنفاق",   data:spendS, borderColor:"#F0006A",backgroundColor:"rgba(240,0,106,.08)",tension:.35,fill:true,pointRadius:3,pointBackgroundColor:"#F0006A"},
    {label:"الإيرادات", data:revS,   borderColor:"#00A86B",backgroundColor:"rgba(0,168,107,.08)",tension:.35,fill:true,pointRadius:3,pointBackgroundColor:"#00A86B"},
    ...prev(pSpend,"#F0006A","الإنفاق"),...prev(pRev,"#00A86B","الإيرادات")
  ];
}

/* ============ Marketing ============ */
function renderMarketing(rows){
  const ct=computeChannelTotals(rows);
  const ch=getDisplayChannels(ct);
  const colors=ch.map(n=>COL.channels[n].color);
  drawChart("channelComboChart","bar",{labels:ch,datasets:[
    {label:"الإنفاق",  data:ch.map(n=>ct[n].spend),  backgroundColor:"#F0006A",borderRadius:6},
    {label:"الإيرادات",data:ch.map(n=>ct[n].revenue),backgroundColor:"#00A86B",borderRadius:6}
  ]});
  drawChart("roasChannelChart","bar",{labels:ch,datasets:[{label:"ROAS",data:ch.map(n=>+ct[n].roas.toFixed(2)),backgroundColor:colors,borderRadius:6}]},{indexAxis:"y"});
  drawChart("ordersChannelChart","bar",{labels:ch,datasets:[{label:"الطلبات",data:ch.map(n=>ct[n].trans),backgroundColor:"#2563EB",borderRadius:6}]});
  const scat=ch.map(n=>{const c=ct[n];const ctr=c.imp?(c.click/c.imp)*100:0;const cr=c.click?(c.trans/c.click)*100:0;return{x:+ctr.toFixed(2),y:+cr.toFixed(2),label:n};});
  drawChart("efficiencyChart","scatter",{datasets:scat.map((p,i)=>({label:p.label,data:[p],backgroundColor:colors[i],borderColor:colors[i],pointRadius:9,pointHoverRadius:13}))},
    {scales:{x:{title:{display:true,text:"CTR %",color:"#9A7285"},ticks:{color:"#9A7285"},grid:{color:"rgba(240,0,106,.06)"}},y:{title:{display:true,text:"CR %",color:"#9A7285"},ticks:{color:"#9A7285"},grid:{color:"rgba(240,0,106,.06)"}}}});
  renderChannelTable(ct,ch);
}

function renderChannelTable(ct,ch){
  CHANNEL_TABLE_DATA=ch.map(n=>{
    const c=ct[n];
    const ctr=c.imp?(c.click/c.imp):0;
    const cr =c.click?(c.trans/c.click):0;
    return{name:n,spend:c.spend,imp:c.imp,click:c.click,ctr,trans:c.trans,cr,revenue:c.revenue,roas:c.roas};
  });
  paintChannelTable();
}
function paintChannelTable(){
  const q=(document.getElementById("tableSearch")?.value||"").toLowerCase();
  let d=CHANNEL_TABLE_DATA.filter(r=>r.name.toLowerCase().includes(q));
  if(TABLE_SORT_COL) d=d.slice().sort((a,b)=>{const av=a[TABLE_SORT_COL],bv=b[TABLE_SORT_COL];return typeof av==="string"?TABLE_SORT_DIR*av.localeCompare(bv):TABLE_SORT_DIR*(av-bv);});
  const tb=document.getElementById("channelTableBody");
  if(!tb) return;
  tb.innerHTML=d.map(r=>{
    let st="warn",lb="متوسط";
    if(r.roas>=5){st="good";lb="ممتاز";}else if(r.roas<2){st="bad";lb="ضعيف";}
    const col=COL.channels[r.name]?.color||"#F0006A";
    return `<tr>
      <td class="sticky-col"><span style="color:${col}">●</span> <strong>${r.name}</strong></td>
      <td>${fmtMoney(r.spend)}</td><td>${fmtMoney(r.imp)}</td><td>${fmtMoney(r.click)}</td>
      <td>${(r.ctr*100).toFixed(2)}%</td><td>${fmtMoney(r.trans)}</td>
      <td>${(r.cr*100).toFixed(2)}%</td><td>${fmtMoney(r.revenue)}</td>
      <td><strong>${r.roas.toFixed(2)}x</strong></td>
      <td><span class="status-pill ${st}">${lb}</span></td>
    </tr>`;
  }).join("");
}

/* ============ Funnel ============ */
function renderFunnel(rows){
  const t=computeTotals(rows);
  const traffic=sumCol(rows,COL.webTraffic);
  const clicks=sumCol(rows,COL.click);
  document.getElementById("fnTraffic").textContent=fmtMoney(traffic);
  document.getElementById("fnOrders").textContent=fmtMoney(t.orders);
  document.getElementById("fnCr").textContent=(t.cr*100).toFixed(2)+"%";
  document.getElementById("fnAov").textContent=fmtMoney(t.aov);
  drawChart("funnelChart","bar",{labels:["الزيارات","النقرات","الطلبات"],datasets:[{label:"عدد",data:[traffic,clicks,t.orders],backgroundColor:["#2563EB","#7C3AED","#00A86B"],borderRadius:8}]},{indexAxis:"y",plugins:{legend:{display:false}}});
  const groups=groupRows(rows,GROUP_BY);
  drawChart("ordersTrend","line",{labels:groups.map(g=>g.label),datasets:[{label:"الطلبات",data:groups.map(g=>sumCol(g.rows,COL.orders)),borderColor:"#EA580C",backgroundColor:"rgba(234,88,12,.1)",tension:.35,fill:true,pointRadius:3}]});
}

/* ============ Computations ============ */
function computeTotals(rows){
  const spend=sumCol(rows,COL.totalSpend),revenue=sumCol(rows,COL.totalRevenue);
  const orders=sumCol(rows,COL.orders),imp=sumCol(rows,COL.imp),clicks=sumCol(rows,COL.click);
  return{spend,revenue,orders,roas:spend?revenue/spend:0,aov:orders?revenue/orders:0,cpo:orders?spend/orders:0,cr:clicks?orders/clicks:0,ctr:imp?clicks/imp:0};
}
function computeChannelTotals(rows){
  const out={};
  for(const[n,c]of Object.entries(COL.channels)){
    const spend=sumCol(rows,c.spend),revenue=sumCol(rows,c.revenue);
    out[n]={spend,revenue,imp:sumCol(rows,c.imp),click:sumCol(rows,c.click),trans:sumCol(rows,c.trans),roas:spend?revenue/spend:0};
  }
  return out;
}

/* ============ INSIGHTS ============ */
function renderInsights(rows,prev){
  const t=computeTotals(rows);
  const p=computeTotals(prev);
  const ct=computeChannelTotals(rows);
  const traffic=sumCol(rows,COL.webTraffic);
  const clicks=sumCol(rows,COL.click);

  const issues=detectIssues(t,ct,p,rows,traffic,clicks);
  const score=calcHealthScore(t,ct,issues);

  paintHealthBanner(score,t,p);
  paintIssues(issues);
  paintFunnelDiagnosis(traffic,clicks,t);
  paintPriorityActions(issues,t,ct);

  // Badge count
  const high=issues.filter(i=>i.sev==="high").length;
  const badge=document.getElementById("insightsBadge");
  if(badge){badge.style.display=high>0?"inline-flex":"none";badge.textContent=high;}
}

function detectIssues(t,ct,p,rows,traffic,clicks){
  const issues=[];

  /* 1. إجمالي ROAS */
  if(t.roas>0 && t.roas<2){
    issues.push({sev:"high",emoji:"📉",cat:"ROAS",
      title:"ROAS إجمالي منخفض جداً",
      desc:`العائد على الإنفاق ${t.roas.toFixed(2)}x — أقل من الحد الأدنى المقبول (2x). كل ريال مُنفق يُعيد أقل من ريالين.`,
      recs:["أوقف أو قلّص الميزانية عن القنوات ذات ROAS < 1","راجع صفحات الهبوط وتحسينها للتحويل","اختبر جماهير جديدة وكرييتيف مختلف"]
    });
  } else if(t.roas>0 && t.roas<4){
    issues.push({sev:"med",emoji:"⚠️",cat:"ROAS",
      title:"ROAS يحتاج تحسيناً",
      desc:`العائد ${t.roas.toFixed(2)}x — جيد لكن لم يصل للمستهدف المثالي (4x+).`,
      recs:["ركّز الميزانية على القنوات الأعلى ROAS","اختبر تحسين الـ creatives وصور المنتجات","تفعيل Retargeting للزوار الذين لم يشتروا"]
    });
  }

  /* 2. CTR منخفض */
  const ctr=t.ctr;
  if(ctr>0 && ctr<0.005){
    issues.push({sev:"high",emoji:"👁️",cat:"CTR",
      title:"معدل النقر (CTR) ضعيف جداً",
      desc:`CTR الإجمالي ${(ctr*100).toFixed(2)}% — أقل من 0.5%، مما يعني أن الإعلانات لا تستقطب انتباه الجمهور المستهدف.`,
      recs:["غيّر الـ hook الأول في الفيديو (أول 3 ثوانٍ حاسمة)","جرّب صور منتجات بخلفية فاتحة ونظيفة","اختبر copy تسليط الضوء على العرض والسعر"]
    });
  } else if(ctr>0 && ctr<0.015){
    issues.push({sev:"med",emoji:"🎯",cat:"CTR",
      title:"CTR أقل من المستهدف",
      desc:`CTR ${(ctr*100).toFixed(2)}% — يحتاج تحسيناً للوصول لـ 1.5%+.`,
      recs:["A/B test للـ headline والـ CTA","استخدام UGC content وتجارب العملاء","استهداف interests أكثر دقة وتخصصاً"]
    });
  }

  /* 3. معدل التحويل */
  const cr=t.cr;
  if(cr>0 && cr<0.01){
    issues.push({sev:"high",emoji:"🛒",cat:"تحويل",
      title:"معدل تحويل الموقع منخفض جداً",
      desc:`CR ${(cr*100).toFixed(2)}% — معظم الزوار يغادرون دون شراء. قد تكون مشكلة في الموقع أو العرض أو الثقة.`,
      recs:["أضف آراء العملاء بصور حقيقية على صفحة المنتج","بسّط عملية الدفع (تقليل الخطوات)","أضف ضمان استرداد وتوصيل سريع في مكان بارز","تحقق من سرعة تحميل الموقع على الجوال"]
    });
  } else if(cr>0 && cr<0.025){
    issues.push({sev:"med",emoji:"⚡",cat:"تحويل",
      title:"معدل التحويل يمكن رفعه",
      desc:`CR ${(cr*100).toFixed(2)}% — مقبول لكن هناك فرصة لرفعه إلى 2.5%+.`,
      recs:["تفعيل exit-intent popup بعرض خصم","استخدام urgency: 'متبقي 5 قطع فقط'","تحسين صور المنتج (أكثر من 5 صور + فيديو"]
    });
  }

  /* 4. تكلفة الطلب مرتفعة */
  if(t.cpo>0 && t.aov>0 && t.cpo>(t.aov*0.4)){
    issues.push({sev:"high",emoji:"💸",cat:"CPO",
      title:"تكلفة الطلب مرتفعة نسبة للقيمة",
      desc:`تكلفة الطلب ${fmtMoney(t.cpo)} — تمثل ${((t.cpo/t.aov)*100).toFixed(0)}% من متوسط قيمة الطلب (${fmtMoney(t.aov)}). الهامش قد يكون ضيقاً.`,
      recs:["رفع متوسط قيمة الطلب بعروض bundle","تقليل الإنفاق على القنوات عالية CPO","تفعيل Upsell/Cross-sell في صفحة الـ checkout"]
    });
  }

  /* 5. قنوات خاسرة (ROAS < 1) */
  const losingCh=Object.entries(ct).filter(([_,c])=>c.spend>100&&c.roas>0&&c.roas<1);
  if(losingCh.length>0){
    const names=losingCh.map(([n])=>n).join("، ");
    issues.push({sev:"high",emoji:"🔴",cat:"قنوات",
      title:`قنوات تخسر ميزانية: ${names}`,
      desc:`هذه القنوات تنفق أكثر مما تُعيد — كل ريال مُنفق لا يُغطى بالإيرادات.`,
      recs:["أوقف الإنفاق مؤقتاً وراجع الاستهداف","اختبر جماهير مختلفة أو أنواع حملات أخرى","قارن الـ creative مع القنوات الرابحة"]
    });
  }

  /* 6. تركيز المخاطر */
  const totalSpend=Object.values(ct).reduce((s,c)=>s+c.spend,0);
  if(totalSpend>0){
    const topCh=Object.entries(ct).sort((a,b)=>b[1].spend-a[1].spend)[0];
    if(topCh && topCh[1].spend/totalSpend>0.6){
      issues.push({sev:"med",emoji:"⚖️",cat:"توزيع",
        title:`تركيز ميزانية عالٍ على ${topCh[0]}`,
        desc:`${topCh[0]} يستحوذ على ${((topCh[1].spend/totalSpend)*100).toFixed(0)}% من الميزانية. انقطاع في هذه القناة سيؤثر كثيراً.`,
        recs:["وزّع الميزانية على 3-4 قنوات على الأقل","جرّب رفع إنفاق القنوات ذات ROAS الجيد","أنشئ حملة اختبارية بـ 10% على قناة جديدة"]
      });
    }
  }

  /* 7. غياب بيانات الزيارات */
  if(traffic===0){
    issues.push({sev:"med",emoji:"📊",cat:"بيانات",
      title:"لا تتوفر بيانات الزيارات",
      desc:"بيانات زيارات الموقع (Sessions) غير مربوطة. لا يمكن حساب معدل التحويل الحقيقي.",
      recs:["تأكد من ربط Google Analytics 4 بالشيت","راجع إعداد العمود الخاص بالزيارات في المصدر"]
    });
  }

  /* 8. إيجابيات */
  const bestCh=Object.entries(ct).filter(([_,c])=>c.spend>100).sort((a,b)=>b[1].roas-a[1].roas)[0];
  if(bestCh && bestCh[1].roas>=5){
    issues.push({sev:"low",emoji:"🌟",cat:"فرصة",
      title:`${bestCh[0]} يحقق أداء ممتازاً`,
      desc:`ROAS ${bestCh[1].roas.toFixed(2)}x — هذه القناة تُعيد أكثر من 5 أضعاف الإنفاق. فرصة لزيادة الميزانية.`,
      recs:["ارفع ميزانية هذه القناة تدريجياً 20-30%","أنشئ lookalike audiences من عملائها","استخدم نفس الـ creative في القنوات الأخرى"]
    });
  }

  return issues;
}

function calcHealthScore(t,ct,issues){
  let score=100;
  const high=issues.filter(i=>i.sev==="high").length;
  const med =issues.filter(i=>i.sev==="med").length;
  score-=high*18;
  score-=med*7;
  if(t.roas>4) score+=5;
  if(t.cr>0.02) score+=5;
  return Math.max(10,Math.min(100,Math.round(score)));
}

function paintHealthBanner(score,t,p){
  const el=document.getElementById("healthScoreNum");
  if(el) el.textContent=score;
  const arc=document.getElementById("healthArc");
  if(arc){
    const pct=score/100;
    const dash=264;
    arc.style.strokeDashoffset=String(dash-(dash*pct));
  }
  const titleEl=document.getElementById("healthScoreTitle");
  const descEl =document.getElementById("healthScoreDesc");
  if(score>=80){if(titleEl)titleEl.textContent="🟢 أداء تسويقي قوي";if(descEl)descEl.textContent="الحملات تعمل بكفاءة — فرص للتحسين موجودة دائماً";}
  else if(score>=60){if(titleEl)titleEl.textContent="🟡 أداء متوسط — يحتاج تحسين";if(descEl)descEl.textContent="هناك مشكلات واضحة يمكن معالجتها لرفع الأداء";}
  else if(score>=40){if(titleEl)titleEl.textContent="🟠 أداء ضعيف — تدخل مطلوب";if(descEl)descEl.textContent="الحملات تحتاج مراجعة جذرية في الاستهداف والـ creative";}
  else{if(titleEl)titleEl.textContent="🔴 أداء حرج — إجراء عاجل";if(descEl)descEl.textContent="خسائر في الإنفاق الإعلاني — يجب وقف وإعادة هيكلة الحملات";}

  const statsEl=document.getElementById("healthStats");
  if(statsEl){
    statsEl.innerHTML=[
      {l:"ROAS الكلي",v:t.roas.toFixed(2)+"x"},
      {l:"معدل التحويل",v:(t.cr*100).toFixed(2)+"%"},
      {l:"CTR الإجمالي",v:(t.ctr*100).toFixed(2)+"%"},
      {l:"تكلفة الطلب",v:fmtMoney(t.cpo)+" ر.س"}
    ].map(s=>`<div class="health-stat"><div class="health-stat-label">${s.l}</div><div class="health-stat-val">${s.v}</div></div>`).join("");
  }
}

function paintIssues(issues){
  const grid=document.getElementById("issuesGrid");
  const cnt =document.getElementById("issuesCount");
  if(!grid) return;
  const sevOrder={high:0,med:1,low:2};
  const sorted=[...issues].sort((a,b)=>sevOrder[a.sev]-sevOrder[b.sev]);
  if(cnt) cnt.textContent=issues.length+" مشكلة";
  grid.innerHTML=sorted.map(is=>`
    <div class="issue-card sev-${is.sev}">
      <div class="issue-header">
        <div class="issue-title-wrap">
          <span class="issue-emoji">${is.emoji}</span>
          <span class="issue-title">${is.title}</span>
        </div>
        <span class="sev-badge sev-${is.sev}">${{high:"عاجل",med:"متوسط",low:"فرصة"}[is.sev]}</span>
      </div>
      <p class="issue-desc">${is.desc}</p>
      <div class="issue-recs">${is.recs.map(r=>`<div class="issue-rec">${r}</div>`).join("")}</div>
    </div>`).join("");
}

function paintFunnelDiagnosis(traffic,clicks,t){
  const el=document.getElementById("funnelDiagnosis");
  if(!el) return;

  const imp=t.ctr>0&&clicks>0?Math.round(clicks/t.ctr):0;
  const clickRate=imp>0?(clicks/imp)*100:0;
  const crRate=clicks>0?(t.orders/clicks)*100:0;
  const siteConv=traffic>0?(t.orders/traffic)*100:0;

  function badge(val,good,warn){
    if(val>=good) return`<span class="funnel-drop-badge ok">جيد ✓</span>`;
    if(val>=warn) return`<span class="funnel-drop-badge warn">متوسط</span>`;
    return`<span class="funnel-drop-badge bad">ضعيف ↓</span>`;
  }
  function bar(pct,color){return`<div class="funnel-bar-wrap"><div class="funnel-bar-bg"><div class="funnel-bar-fill" style="width:${Math.min(100,pct)}%;background:${color}"></div></div></div>`;}

  el.innerHTML=`
    <div class="funnel-step">
      <div class="funnel-step-icon" style="background:#EBF1FF">📡</div>
      <div class="funnel-step-info">
        <div class="funnel-step-title">مرحلة الوعي — الظهور</div>
        <div class="funnel-step-vals">
          <span class="funnel-val">الظهور: <strong>${fmtMoney(imp)}</strong></span>
          <span class="funnel-val">CTR: <strong>${clickRate.toFixed(2)}%</strong></span>
        </div>
      </div>
      ${bar(clickRate/2*100,"#2563EB")}
      ${badge(clickRate,1.5,0.5)}
    </div>
    <div class="funnel-arrow">↓</div>
    <div class="funnel-step">
      <div class="funnel-step-icon" style="background:#FFF0F5">👆</div>
      <div class="funnel-step-info">
        <div class="funnel-step-title">مرحلة الاهتمام — النقرات</div>
        <div class="funnel-step-vals">
          <span class="funnel-val">النقرات: <strong>${fmtMoney(clicks)}</strong></span>
          <span class="funnel-val">نسبة وصول: <strong>${clickRate.toFixed(2)}%</strong></span>
        </div>
      </div>
      ${bar(clickRate/2*100,"#F0006A")}
      ${badge(clickRate,1.5,0.5)}
    </div>
    <div class="funnel-arrow">↓</div>
    <div class="funnel-step">
      <div class="funnel-step-icon" style="background:#F0FFF7">🌐</div>
      <div class="funnel-step-info">
        <div class="funnel-step-title">مرحلة التقييم — زيارة الموقع</div>
        <div class="funnel-step-vals">
          <span class="funnel-val">الزيارات: <strong>${fmtMoney(traffic)||"غير متاح"}</strong></span>
          <span class="funnel-val">تحويل الموقع: <strong>${traffic>0?siteConv.toFixed(2)+"%":"—"}</strong></span>
        </div>
      </div>
      ${bar(siteConv*20,"#00A86B")}
      ${traffic>0?badge(siteConv,2,0.8):`<span class="funnel-drop-badge warn">لا بيانات</span>`}
    </div>
    <div class="funnel-arrow">↓</div>
    <div class="funnel-step">
      <div class="funnel-step-icon" style="background:#FFF5EB">🛍️</div>
      <div class="funnel-step-info">
        <div class="funnel-step-title">مرحلة الشراء — إتمام الطلب</div>
        <div class="funnel-step-vals">
          <span class="funnel-val">الطلبات: <strong>${fmtMoney(t.orders)}</strong></span>
          <span class="funnel-val">CR (من النقر): <strong>${crRate.toFixed(2)}%</strong></span>
          <span class="funnel-val">متوسط الطلب: <strong>${fmtMoney(t.aov)} ر.س</strong></span>
        </div>
      </div>
      ${bar(crRate*10,"#EA580C")}
      ${badge(crRate,2,0.8)}
    </div>
  `;
}

function paintPriorityActions(issues,t,ct){
  const el=document.getElementById("priorityActions");
  if(!el) return;

  const high=issues.filter(i=>i.sev==="high");
  const med =issues.filter(i=>i.sev==="med");
  const pool=[...high,...med].slice(0,3);

  if(pool.length===0){
    el.innerHTML=`<div class="issues-empty">✅ لا توجد مشكلات حرجة — استمر في مراقبة الأداء أسبوعياً</div>`;
    return;
  }

  const impactLabels=[
    "يمكن رفع ROAS الكلي بنسبة 20-40%",
    "يمكن تحسين معدل التحويل وتقليل التكلفة",
    "يرفع كفاءة الإنفاق ويحمي الميزانية"
  ];

  el.innerHTML=pool.map((issue,i)=>`
    <div class="action-card">
      <div class="action-num">${i+1}</div>
      <div class="action-title">${issue.emoji} ${issue.title}</div>
      <div class="action-desc">${issue.recs[0]}</div>
      <div class="action-impact">📈 ${impactLabels[i]||"يحسّن الكفاءة التسويقية"}</div>
    </div>`).join("");
}

/* ============ Charts ============ */
function drawChart(id,type,data,extraOpts={}){
  const el=document.getElementById(id);if(!el) return;
  if(CHARTS[id]) CHARTS[id].destroy();
  const isDough=(type==="doughnut"||type==="pie");
  const base={
    responsive:true,maintainAspectRatio:false,
    animation:{duration:600,easing:"easeOutQuart"},
    plugins:{
      legend:{labels:{color:"#9A7285",font:{family:"Tajawal",size:11},boxWidth:10,boxHeight:10,padding:12}},
      tooltip:{backgroundColor:"rgba(26,8,18,.92)",borderColor:"rgba(240,0,106,.15)",borderWidth:1,
        titleFont:{family:"Tajawal",size:13},bodyFont:{family:"Tajawal",size:12},padding:10,cornerRadius:10,
        callbacks:{label:ctx=>{const v=ctx.parsed?.y??ctx.parsed??ctx.raw;return typeof v==="number"?" "+fmtMoney(v):" "+v;}}}
    },
    scales:isDough?{}:{
      x:{ticks:{color:"#C4A8B8",font:{family:"Tajawal",size:11},maxRotation:30},grid:{color:"rgba(240,0,106,.05)"}},
      y:{ticks:{color:"#C4A8B8",font:{family:"Tajawal",size:11}},grid:{color:"rgba(240,0,106,.05)"}}
    }
  };
  const opts={...base,...extraOpts};
  if(extraOpts.scales)  opts.scales ={...base.scales, ...extraOpts.scales};
  if(extraOpts.plugins) opts.plugins={...base.plugins,...extraOpts.plugins};
  CHARTS[id]=new Chart(el.getContext("2d"),{type,data,options:opts});
}

/* ============ Chips ============ */
function buildChannelChips(){
  const wrap=document.getElementById("channelChips");if(!wrap) return;
  wrap.innerHTML=Object.keys(COL.channels).map(n=>`<button class="chip active" data-ch="${n}" style="--cc:${COL.channels[n].color}">${n}</button>`).join("");
  wrap.querySelectorAll(".chip").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const ch=btn.dataset.ch;
      btn.classList.toggle("active");
      ACTIVE_CHANNELS[btn.classList.contains("active")?"add":"delete"](ch);
      render();
    });
  });
}

/* ============ Tab Switch ============ */
function switchTab(tab){
  CURRENT_TAB=tab;
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  document.querySelectorAll(".bnav-item").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
  document.querySelectorAll(".tab-content").forEach(s=>s.classList.toggle("active",s.dataset.tabContent===tab));
  const titles={
    overview: ["نظرة عامة على الأداء","ملخص شامل لأداء التسويق والمبيعات"],
    marketing:["أداء التسويق الرقمي","تحليل تفصيلي لكل قناة تسويقية"],
    funnel:   ["قمع التحويل","رحلة الزائر من الإعلان إلى الشراء"],
    insights: ["التشخيص والحلول","تحليل ذكي للمشكلات وأولويات الحل"]
  };
  document.getElementById("pageTitle").textContent    = titles[tab]?.[0]||"";
  document.getElementById("pageSubtitle").textContent = titles[tab]?.[1]||"";
  render();
}

/* ============ Sidebar mobile ============ */
function toggleSidebar(force){
  const sb=document.getElementById("sidebar");
  const ov=document.getElementById("sidebarOverlay");
  const hm=document.getElementById("hamburgerBtn");
  const open=force!==undefined?force:!sb.classList.contains("open");
  sb.classList.toggle("open",open);
  ov.classList.toggle("visible",open);
  hm.classList.toggle("open",open);
  document.body.style.overflow=open?"hidden":"";
}

/* ============ Filter bar toggle ============ */
function toggleFilterBar(force){
  const body  =document.getElementById("filterBody");
  const chevron=document.getElementById("filterChevron");
  FILTER_OPEN=force!==undefined?force:!FILTER_OPEN;
  body?.classList.toggle("open",FILTER_OPEN);
  chevron?.classList.toggle("open",FILTER_OPEN);
}

function updateFilterSummary(){
  const periodLabel={all:"الكل",day:"اليوم",week:"أسبوع",month:"شهر",quarter:"ربع سنة",custom:"مخصص"};
  const groupLabel={day:"يومي",week:"أسبوعي",month:"شهري"};
  const el=document.getElementById("filterSummary");
  if(el) el.textContent=`${periodLabel[CURRENT_PERIOD]||CURRENT_PERIOD} · ${groupLabel[GROUP_BY]||GROUP_BY}`;
}

/* ============ Export ============ */
function doExport(){
  const btn=document.getElementById("exportBtn");
  btn.classList.add("loading");
  html2canvas(document.getElementById("mainContent"),{backgroundColor:"#FDF5F8",scale:1.5,useCORS:true,logging:false})
    .then(c=>{const a=document.createElement("a");a.download="joli-dashboard-"+Date.now()+".png";a.href=c.toDataURL("image/png");a.click();})
    .catch(e=>console.error(e))
    .finally(()=>btn.classList.remove("loading"));
}

/* ============ Wire Events ============ */
function wireEvents(){
  document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>{switchTab(b.dataset.tab);toggleSidebar(false);}));
  document.querySelectorAll(".bnav-item").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
  document.getElementById("hamburgerBtn")?.addEventListener("click",()=>toggleSidebar());
  document.getElementById("sidebarOverlay")?.addEventListener("click",()=>toggleSidebar(false));
  document.getElementById("filterBarToggle")?.addEventListener("click",()=>toggleFilterBar());

  document.querySelectorAll(".period-btn").forEach(b=>{
    b.addEventListener("click",()=>{
      document.querySelectorAll(".period-btn").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      CURRENT_PERIOD=b.dataset.period;
      document.getElementById("dateRangeWrap").style.display=CURRENT_PERIOD==="custom"?"flex":"none";
      updateFilterSummary();
      render();
    });
  });

  document.getElementById("dateFrom")?.addEventListener("change",render);
  document.getElementById("dateTo")  ?.addEventListener("change",render);
  document.getElementById("groupBy")?.addEventListener("change",e=>{GROUP_BY=e.target.value;updateFilterSummary();render();});
  document.getElementById("compareToggle")?.addEventListener("change",e=>{COMPARE_ON=e.target.checked;render();});
  document.getElementById("trendMetric")?.addEventListener("change",e=>{TREND_METRIC=e.target.value;render();});

  document.querySelectorAll(".topn-btn").forEach(b=>{
    b.addEventListener("click",()=>{
      document.querySelectorAll(".topn-btn").forEach(x=>x.classList.remove("active"));
      b.classList.add("active"); TOP_N=b.dataset.topn; render();
    });
  });

  document.getElementById("refreshBtn")?.addEventListener("click",loadData);
  document.getElementById("exportBtn")?.addEventListener("click",doExport);
  document.getElementById("tableSearch")?.addEventListener("input",paintChannelTable);

  document.querySelectorAll("th.sortable").forEach(th=>{
    th.addEventListener("click",()=>{
      const col=th.dataset.sort;
      TABLE_SORT_DIR=TABLE_SORT_COL===col?TABLE_SORT_DIR*-1:-1;
      TABLE_SORT_COL=col;
      document.querySelectorAll("th.sortable").forEach(t=>t.classList.remove("sorted-asc","sorted-desc"));
      th.classList.add(TABLE_SORT_DIR===1?"sorted-asc":"sorted-desc");
      paintChannelTable();
    });
  });
}

/* ============ Init ============ */
buildChannelChips();
wireEvents();
updateFilterSummary();
// Start with filter bar open on desktop, closed on mobile
if(window.innerWidth>768) toggleFilterBar(true);
loadData();
