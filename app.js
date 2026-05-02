/* ============================================================
   Joli Monitoring — Marketing Dashboard
   Connected to Google Sheets (Daily Performance)
============================================================ */

const SHEET_ID  = "18pvf_fuBjtBdYX4CAFgFCAmaYIRLpVGzsG_0FX0LqfY";
const SHEET_GID = "1602116591"; // Daily Performance
// ⚠️ tq=select * يتجاوز الفلتر المُطبَّق داخل الشيت ويُرجع كل الصفوف
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}&tq=${encodeURIComponent("select *")}`;

/* === Column indexes (0-based) — verified from sheet structure === */
const COL = {
  year: 1, month: 2, day: 3,
  webTraffic: 5, imp: 6, click: 7, ctr: 8,
  orders: 9, cr: 10, costOrder: 11, aov: 12,
  totalSpend: 14, totalRevenue: 15, accountRevenue: 16, roas: 17,
  channels: {
    "Google Ads":   { spend:19, imp:20, click:21, trans:22, revenue:23, roas:24, color:"#3b82f6" },
    "Snapchat":     { spend:26, imp:27, click:28, trans:29, revenue:30, roas:31, color:"#facc15" },
    "Meta":         { spend:33, imp:34, click:35, trans:36, revenue:37, roas:38, color:"#1877f2" },
    "TikTok":       { spend:40, imp:41, click:42, trans:43, revenue:44, roas:45, color:"#ec4899" },
    "X": { spend:47, imp:null, click:null, trans:null, revenue:48, roas:49, color:"#a855f7" },
    "Influencer":   { spend:51, imp:52, click:53, trans:54, revenue:55, roas:56, color:"#10b981" },
    "WhatsApp":     { spend:58, imp:59, click:60, trans:61, revenue:62, roas:63, color:"#22c55e" }
  }
};

let RAW_ROWS = [];
let ACTIVE_CHANNELS = new Set(Object.keys(COL.channels));
let CHARTS = {};
let CURRENT_TAB = "overview";
let CURRENT_PERIOD = "all";
let GROUP_BY = "day";

/* ============================================================
   Helpers
============================================================ */
const num = v => {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[,٬\s%"$]/g, ""));
  return isNaN(n) ? 0 : n;
};
const fmt = (n, d=0) => Number(n||0).toLocaleString("en-US",{maximumFractionDigits:d});
const fmtMoney = n => fmt(n,0);
const fmtPct = n => (n*100).toFixed(2)+"%";

/* Parse "01/Apr/2026" → Date */
function parseRowDate(str){
  if(!str) return null;
  const m = String(str).match(/(\d{1,2})\/([A-Za-z]+)\/(\d{4})/);
  if(!m) return null;
  const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  return new Date(+m[3], months[m[2]] ?? 0, +m[1]);
}

/* Format Date → short label */
function fmtDateShort(d){
  if(!d) return "";
  return d.toLocaleDateString("en-GB",{day:"2-digit",month:"short"});
}

/* Δ% setter for KPI cards */
function setDelta(id, current, previous, invert=false){
  const el = document.getElementById(id);
  if(!el) return;
  if(!previous || !isFinite(previous) || previous === 0){ el.textContent=""; return; }
  const pct  = ((current - previous) / Math.abs(previous)) * 100;
  const isUp = pct > 0;
  const isGood = invert ? !isUp : isUp;
  const arrow = pct>0 ? "▲" : (pct<0 ? "▼" : "●");
  el.className = "kpi-delta " + (Math.abs(pct)<0.01 ? "flat" : (isGood ? "up" : "down"));
  el.textContent = `${arrow} ${Math.abs(pct).toFixed(1)}% مقارنة بالفترة السابقة`;
}

/* Sum a column */
const sumCol = (rows, idx) => idx == null ? 0 : rows.reduce((s,r)=>s+num(r[idx]),0);

/* ============================================================
   Load Data
============================================================ */
async function loadData(){
  try{
    const res = await fetch(SHEET_URL + "&_=" + Date.now());
    if(!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    const parsed = Papa.parse(text, { skipEmptyLines:true });

    RAW_ROWS = parsed.data.filter(r =>
      r[COL.day] && /\d{1,2}\/[A-Za-z]+\/\d{4}/.test(r[COL.day])
    );

    console.log("✅ تم تحميل", RAW_ROWS.length, "صف من الشيت");

    document.getElementById("lastUpdate").textContent =
      "آخر تحديث: " + new Date().toLocaleString("ar-EG") +
      " — " + RAW_ROWS.length + " صف";

    if(RAW_ROWS.length === 0){
      console.warn("⚠️ لا توجد صفوف. تأكد من إعدادات المشاركة (Anyone with link → Viewer).");
    }
    render();
  }catch(e){
    console.error("❌ فشل تحميل الشيت:", e);
    document.getElementById("lastUpdate").textContent = "❌ فشل التحميل: " + e.message;
  }
}

/* ============================================================
   Filtering & Period Calculation
============================================================ */
function getSortedRows(){
  const rows = RAW_ROWS.slice();
  rows.sort((a,b) => parseRowDate(a[COL.day]) - parseRowDate(b[COL.day]));
  return rows;
}

function getFilteredRows(){
  const rows = getSortedRows();
  if(!rows.length) return [];

  if(CURRENT_PERIOD === "all") return rows;

  const lastDate = parseRowDate(rows[rows.length-1][COL.day]) || new Date();

  if(CURRENT_PERIOD === "custom"){
    const f = document.getElementById("dateFrom").value;
    const t = document.getElementById("dateTo").value;
    if(!f || !t) return rows;
    const from = new Date(f), to = new Date(t);
    return rows.filter(r => {
      const d = parseRowDate(r[COL.day]);
      return d >= from && d <= to;
    });
  }

  const daysMap = { day:1, week:7, month:30, quarter:90 };
  const days = daysMap[CURRENT_PERIOD] || 30;
  const cutoff = new Date(lastDate);
  cutoff.setDate(lastDate.getDate() - days + 1);
  return rows.filter(r => parseRowDate(r[COL.day]) >= cutoff);
}

/* Equivalent rows from the previous period (for Δ%) */
function getPreviousPeriodRows(currentRows){
  if(!currentRows.length) return [];
  const allSorted = getSortedRows();
  const firstCur = parseRowDate(currentRows[0][COL.day]);
  const lastCur  = parseRowDate(currentRows[currentRows.length-1][COL.day]);
  const span = Math.max(1, Math.round((lastCur - firstCur)/86400000) + 1);

  const prevEnd   = new Date(firstCur); prevEnd.setDate(firstCur.getDate()-1);
  const prevStart = new Date(prevEnd);  prevStart.setDate(prevEnd.getDate() - span + 1);

  return allSorted.filter(r => {
    const d = parseRowDate(r[COL.day]);
    return d >= prevStart && d <= prevEnd;
  });
}

/* ============================================================
   Group By (day / week / month)
============================================================ */
function groupRows(rows, mode){
  if(mode === "day") return rows.map(r => ({label: r[COL.day], rows:[r]}));

  const groups = new Map();
  for(const r of rows){
    const d = parseRowDate(r[COL.day]); if(!d) continue;
    let key;
    if(mode === "week"){
      const tmp = new Date(d);
      const dayOfWeek = (tmp.getDay() + 6) % 7; // Mon=0
      tmp.setDate(tmp.getDate() - dayOfWeek);
      key = tmp.toISOString().slice(0,10);
    } else if(mode === "month"){
      key = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
    }
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([key, rs]) => {
      let label = key;
      if(mode==="week"){
        const d = new Date(key);
        label = "أسبوع " + fmtDateShort(d);
      } else if(mode==="month"){
        const [y,m] = key.split("-");
        label = new Date(+y, +m-1, 1).toLocaleDateString("en-GB",{month:"short",year:"2-digit"});
      }
      return {label, rows: rs};
    });
}

/* ============================================================
   Render Master
============================================================ */
function render(){
  const rows = getFilteredRows();
  const prevRows = getPreviousPeriodRows(rows);

  if(CURRENT_TAB === "overview")  renderOverview(rows, prevRows);
  if(CURRENT_TAB === "marketing") renderMarketing(rows);
  if(CURRENT_TAB === "funnel")    renderFunnel(rows);
}

/* ============================================================
   TAB 1 — Overview
============================================================ */
function renderOverview(rows, prevRows){
  // ------- KPIs -------
  const totals = computeTotals(rows);
  const prev   = computeTotals(prevRows);

  document.getElementById("kpiSpend").textContent   = fmtMoney(totals.spend);
  document.getElementById("kpiRevenue").textContent = fmtMoney(totals.revenue);
  document.getElementById("kpiRoas").textContent    = totals.roas.toFixed(2)+"x";
  document.getElementById("kpiOrders").textContent  = fmtMoney(totals.orders);
  document.getElementById("kpiAov").textContent     = fmtMoney(totals.aov);
  document.getElementById("kpiCr").textContent      = (totals.cr*100).toFixed(2)+"%";
  document.getElementById("kpiCtr").textContent     = (totals.ctr*100).toFixed(2)+"%";
  document.getElementById("kpiCpo").textContent     = fmtMoney(totals.cpo);

  setDelta("kpiSpendDelta",   totals.spend,   prev.spend,   true);   // less is better
  setDelta("kpiRevenueDelta", totals.revenue, prev.revenue, false);
  setDelta("kpiRoasDelta",    totals.roas,    prev.roas,    false);
  setDelta("kpiOrdersDelta",  totals.orders,  prev.orders,  false);
  setDelta("kpiAovDelta",     totals.aov,     prev.aov,     false);
  setDelta("kpiCrDelta",      totals.cr,      prev.cr,      false);
  setDelta("kpiCtrDelta",     totals.ctr,     prev.ctr,     false);
  setDelta("kpiCpoDelta",     totals.cpo,     prev.cpo,     true);

  // ------- Trend (Spend vs Revenue) -------
  const groups = groupRows(rows, GROUP_BY);
  const labels = groups.map(g => g.label);
  const spendSeries   = groups.map(g => sumCol(g.rows, COL.totalSpend));
  const revenueSeries = groups.map(g => sumCol(g.rows, COL.totalRevenue));
  const roasSeries    = groups.map(g => {
    const s = sumCol(g.rows, COL.totalSpend);
    const r = sumCol(g.rows, COL.totalRevenue);
    return s ? +(r/s).toFixed(2) : 0;
  });

  drawChart("trendChart","line",{
    labels,
    datasets:[
      { label:"الإنفاق", data: spendSeries,
        borderColor:"#ef4444", backgroundColor:"rgba(239,68,68,.15)",
        tension:.35, fill:true, pointRadius:3, pointBackgroundColor:"#ef4444" },
      { label:"الإيرادات", data: revenueSeries,
        borderColor:"#10b981", backgroundColor:"rgba(16,185,129,.15)",
        tension:.35, fill:true, pointRadius:3, pointBackgroundColor:"#10b981" }
    ]
  });

  // ------- Donuts: Spend / Revenue distribution -------
  const channelTotals = computeChannelTotals(rows);
  const chNames = Object.keys(channelTotals).filter(n => ACTIVE_CHANNELS.has(n));
  const colors  = chNames.map(n => COL.channels[n].color);

  drawChart("spendDonut","doughnut",{
    labels: chNames,
    datasets:[{ data: chNames.map(n => channelTotals[n].spend), backgroundColor: colors, borderWidth:0 }]
  });
  drawChart("revenueDonut","doughnut",{
    labels: chNames,
    datasets:[{ data: chNames.map(n => channelTotals[n].revenue), backgroundColor: colors, borderWidth:0 }]
  });

  // ------- ROAS Trend -------
  drawChart("roasTrend","line",{
    labels,
    datasets:[{
      label:"ROAS", data: roasSeries,
      borderColor:"#8b5cf6", backgroundColor:"rgba(139,92,246,.18)",
      tension:.35, fill:true, pointRadius:3
    }]
  });
}

/* ============================================================
   TAB 2 — Marketing Performance
============================================================ */
function renderMarketing(rows){
  const channelTotals = computeChannelTotals(rows);
  const chNames = Object.keys(channelTotals).filter(n => ACTIVE_CHANNELS.has(n));
  const colors  = chNames.map(n => COL.channels[n].color);

  // Combo: Spend (bar) + Revenue (bar)
  drawChart("channelComboChart","bar",{
    labels: chNames,
    datasets:[
      { label:"الإنفاق",   data: chNames.map(n => channelTotals[n].spend),   backgroundColor:"#ef4444", borderRadius:6 },
      { label:"الإيرادات", data: chNames.map(n => channelTotals[n].revenue), backgroundColor:"#10b981", borderRadius:6 }
    ]
  });

  drawChart("roasChannelChart","bar",{
    labels: chNames,
    datasets:[{
      label:"ROAS",
      data: chNames.map(n => +channelTotals[n].roas.toFixed(2)),
      backgroundColor: colors, borderRadius:6
    }]
  }, { indexAxis:"y" });

  drawChart("ordersChannelChart","bar",{
    labels: chNames,
    datasets:[{
      label:"الطلبات",
      data: chNames.map(n => channelTotals[n].trans),
      backgroundColor:"#3b82f6", borderRadius:6
    }]
  });

  // Efficiency: scatter CTR vs CR
  const scatterData = chNames.map(n => {
    const c = channelTotals[n];
    const ctr = c.imp ? (c.click/c.imp)*100 : 0;
    const cr  = c.click ? (c.trans/c.click)*100 : 0;
    return { x: +ctr.toFixed(2), y: +cr.toFixed(2), label:n };
  });
  drawChart("efficiencyChart","scatter",{
    datasets: scatterData.map((p,i) => ({
      label: p.label, data:[p],
      backgroundColor: colors[i], borderColor: colors[i],
      pointRadius:9, pointHoverRadius:12
    }))
  }, {
    scales:{
      x:{ title:{display:true,text:"CTR %",color:"#8aa0c2"}, ticks:{color:"#8aa0c2"}, grid:{color:"#243353"} },
      y:{ title:{display:true,text:"CR %",color:"#8aa0c2"},  ticks:{color:"#8aa0c2"}, grid:{color:"#243353"} }
    }
  });

  // Channels Table
  const tbody = document.querySelector("#channelTable tbody");
  tbody.innerHTML = chNames.map(n => {
    const c = channelTotals[n];
    const ctr = c.imp ? (c.click/c.imp) : 0;
    const cr  = c.click ? (c.trans/c.click) : 0;
    let status = "warn", label = "متوسط";
    if(c.roas >= 5)      { status="good"; label="ممتاز"; }
    else if(c.roas < 2)  { status="bad";  label="ضعيف"; }
    return `<tr>
      <td><strong style="color:${COL.channels[n].color}">●</strong> ${n}</td>
      <td>${fmtMoney(c.spend)}</td>
      <td>${fmtMoney(c.imp)}</td>
      <td>${fmtMoney(c.click)}</td>
      <td>${(ctr*100).toFixed(2)}%</td>
      <td>${fmtMoney(c.trans)}</td>
      <td>${(cr*100).toFixed(2)}%</td>
      <td>${fmtMoney(c.revenue)}</td>
      <td><strong>${c.roas.toFixed(2)}x</strong></td>
      <td><span class="status-pill ${status}">${label}</span></td>
    </tr>`;
  }).join("");
}

/* ============================================================
   TAB 3 — Funnel
============================================================ */
function renderFunnel(rows){
  const totals = computeTotals(rows);
  const traffic = sumCol(rows, COL.webTraffic);
  const clicks  = sumCol(rows, COL.click);
  const orders  = totals.orders;

  document.getElementById("fnTraffic").textContent = fmtMoney(traffic);
  document.getElementById("fnOrders").textContent  = fmtMoney(orders);
  document.getElementById("fnCr").textContent      = (totals.cr*100).toFixed(2)+"%";
  document.getElementById("fnAov").textContent     = fmtMoney(totals.aov);

  // Funnel as horizontal bar
  const funnelLabels = ["الزيارات","النقرات","الطلبات"];
  const funnelData   = [traffic, clicks, orders];
  drawChart("funnelChart","bar",{
    labels: funnelLabels,
    datasets:[{
      label:"عدد",
      data: funnelData,
      backgroundColor:["#3b82f6","#8b5cf6","#10b981"],
      borderRadius:8
    }]
  }, { indexAxis:"y", plugins:{ legend:{ display:false } } });

  // Orders Trend
  const groups = groupRows(rows, GROUP_BY);
  const labels = groups.map(g => g.label);
  const ordersSeries = groups.map(g => sumCol(g.rows, COL.orders));
  drawChart("ordersTrend","line",{
    labels,
    datasets:[{
      label:"الطلبات", data: ordersSeries,
      borderColor:"#f97316", backgroundColor:"rgba(249,115,22,.18)",
      tension:.35, fill:true, pointRadius:3
    }]
  });
}

/* ============================================================
   Computations
============================================================ */
function computeTotals(rows){
  const spend   = sumCol(rows, COL.totalSpend);
  const revenue = sumCol(rows, COL.totalRevenue);
  const orders  = sumCol(rows, COL.orders);
  const imp     = sumCol(rows, COL.imp);
  const clicks  = sumCol(rows, COL.click);
  return {
    spend, revenue, orders,
    roas: spend ? revenue/spend : 0,
    aov:  orders ? revenue/orders : 0,
    cpo:  orders ? spend/orders : 0,
    cr:   clicks ? orders/clicks : 0,
    ctr:  imp ? clicks/imp : 0
  };
}

function computeChannelTotals(rows){
  const out = {};
  for(const [name, c] of Object.entries(COL.channels)){
    const spend   = sumCol(rows, c.spend);
    const revenue = sumCol(rows, c.revenue);
    out[name] = {
      spend, revenue,
      imp:   sumCol(rows, c.imp),
      click: sumCol(rows, c.click),
      trans: sumCol(rows, c.trans),
      roas:  spend ? revenue/spend : 0
    };
  }
  return out;
}

/* ============================================================
   Chart Drawer
============================================================ */
function drawChart(id, type, data, extraOpts={}){
  const el = document.getElementById(id);
  if(!el) return;
  if(CHARTS[id]) CHARTS[id].destroy();

  const baseOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{
      legend:{ labels:{ color:"#cbd5e1", font:{ family:"Cairo", size:12 } } },
      tooltip:{ backgroundColor:"#0b1220", borderColor:"#243353", borderWidth:1 }
    },
    scales: (type==="doughnut" || type==="pie") ? {} : {
      x:{ ticks:{ color:"#8aa0c2", font:{family:"Cairo"} }, grid:{ color:"#1b2640" } },
      y:{ ticks:{ color:"#8aa0c2", font:{family:"Cairo"} }, grid:{ color:"#1b2640" } }
    }
  };

  // Merge
  const opts = { ...baseOpts, ...extraOpts };
  if(extraOpts.scales) opts.scales = { ...baseOpts.scales, ...extraOpts.scales };
  if(extraOpts.plugins) opts.plugins = { ...baseOpts.plugins, ...extraOpts.plugins };

  CHARTS[id] = new Chart(el.getContext("2d"), { type, data, options: opts });
}

/* ============================================================
   Channel Chips (dynamic)
============================================================ */
function buildChannelChips(){
  const wrap = document.getElementById("channelChips");
  wrap.innerHTML = Object.keys(COL.channels).map(n =>
    `<button class="chip active" data-ch="${n}" style="--cc:${COL.channels[n].color}">${n}</button>`
  ).join("");

  wrap.querySelectorAll(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const ch = btn.dataset.ch;
      btn.classList.toggle("active");
      if(btn.classList.contains("active")) ACTIVE_CHANNELS.add(ch);
      else ACTIVE_CHANNELS.delete(ch);
      render();
    });
  });
}

/* ============================================================
   Tab Switching
============================================================ */
function switchTab(tab){
  CURRENT_TAB = tab;
  document.querySelectorAll(".nav-item").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  document.querySelectorAll(".tab-content").forEach(s =>
    s.classList.toggle("active", s.dataset.tabContent === tab)
  );

  const titles = {
    overview:  ["نظرة عامة على الأداء","ملخص شامل لأداء التسويق والمبيعات"],
    marketing: ["أداء التسويق الرقمي","تحليل تفصيلي لكل قناة تسويقية"],
    funnel:    ["قمع التحويل","رحلة الزائر من الزيارة إلى الطلب"]
  };
  document.getElementById("pageTitle").textContent    = titles[tab][0];
  document.getElementById("pageSubtitle").textContent = titles[tab][1];

  render();
}

/* ============================================================
   Event Wiring
============================================================ */
function wireEvents(){
  // Tabs
  document.querySelectorAll(".nav-item").forEach(b =>
    b.addEventListener("click", () => switchTab(b.dataset.tab))
  );

  // Period buttons
  document.querySelectorAll(".period-btn").forEach(b => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".period-btn").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      CURRENT_PERIOD = b.dataset.period;
      document.getElementById("dateRangeWrap").style.display =
        CURRENT_PERIOD === "custom" ? "flex" : "none";
      render();
    });
  });

  // Custom date range
  document.getElementById("dateFrom").addEventListener("change", render);
  document.getElementById("dateTo").addEventListener("change", render);

  // Group by
  document.getElementById("groupBy").addEventListener("change", e => {
    GROUP_BY = e.target.value;
    render();
  });

  // Refresh
  document.getElementById("refreshBtn").addEventListener("click", loadData);
}

/* ============================================================
   Init
============================================================ */
buildChannelChips();
wireEvents();
loadData();
