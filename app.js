/* ============================================================
   Joli Monitoring — Marketing Dashboard
   Connected to Google Sheets (Daily Performance)
============================================================ */

const SHEET_ID  = "18pvf_fuBjtBdYX4CAFgFCAmaYIRLpVGzsG_0FX0LqfY";
const SHEET_GID = "1602116591"; // Daily Performance
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

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
    "TikTok Govyy": { spend:47, imp:null, click:null, trans:null, revenue:48, roas:49, color:"#a855f7" },
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

/* Parse date "01/Apr/2026" → Date object */
function parseRowDate(str){
  if(!str) return null;
  const m = String(str).match(/(\d{1,2})\/([A-Za-z]+)\/(\d{4})/);
  if(!m) return null;
  const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  return new Date(+m[3], months[m[2]] ?? 0, +m[1]);
}

/* Δ% formatter */
function setDelta(id, current, previous, invert=false){
  const el = document.getElementById(id);
  if(!el) return;
  if(!previous){ el.textContent=""; return; }
  const pct = ((current-previous)/Math.abs(previous))*100;
  const up  = invert ? pct < 0 : pct > 0;
  const arrow = pct>0?"▲":(pct<0?"▼":"●");
  el.className = "kpi-delta " + (Math.abs(pct)<0.01 ? "flat" : (up?"up":"down"));
  el.textContent = `${arrow} ${Math.abs(pct).toFixed(1)}% مقارنة بالفترة السابقة`;
}

/* ============================================================
   Load data from Google Sheets
============================================================ */
async function loadData(){
  try{
    const res = await fetch(SHEET_URL + "&_=" + Date.now());
    const text = await res.text();
    const parsed = Papa.parse(text, { skipEmptyLines:true });
    RAW_ROWS = parsed.data.filter(r => r[COL.day] && parseRowDate(r[COL.day]));
    document.getElementById("lastUpdate").textContent =
      "آخر تحديث: " + new Date().toLocaleString("ar-EG");
    render();
  }catch(e){
    console.error("Sheet load failed:", e);
    alert("تعذر جلب البيانات. تأكد أن الشيت Public.");
  }
}

/* ============================================================
   Filtering
============================================================ */
function getFilteredRows(){
  let rows = RAW_ROWS.slice();
  // sort by date
  rows.sort((a,b) => parseRowDate(a[COL.day]) - parseRowDate(b[COL.day]));

  if(CURRENT_PERIOD === "all") return rows;

  const today = parseRowDate(rows[rows.length-1]?.[COL.day]) || new Date();
  let cutoff = new Date(today);

  if(CURRENT_PERIOD === "day")     cutoff.setDate(today.getDate()-1);
  if(CURRENT_PERIOD === "week")    cutoff.setDate(today.getDate()-7);
  if(CURRENT_PERIOD === "month")   cutoff.setDate(today.getDate()-30);
  if(CURRENT_PERIOD === "quarter") cutoff.setDate(today.getDate()-90);

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

  return rows.filter(r => parseRowDate(r[COL.day]) >= cutoff);
}

/* Previous-period rows for Δ% */
function getPreviousPeriodRows(rows){
  if(!rows.length) return [];
  const first = parseRowDate(rows[0][COL.day]);
  const last  = parseRowDate(rows[rows.length-1][COL.day]);
  const days  = Math.max(1, Math.round((last-first)/86400000)
