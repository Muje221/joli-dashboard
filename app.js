// ====== الإعدادات ======
const SHEET_ID   = "18pvf_fuBjtBdYX4CAFgFCAmaYIRLpVGzsG_0FX0LqfY";
const SHEET_GID  = "1602116591"; // Daily Performance
// gviz endpoint يعمل لو الشيت "Anyone with the link can view"
const SHEET_URL  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

// ترتيب الأعمدة المتوقع (بناء على الفحص)
// ملاحظة: الفهارس تبدأ من 0
const COL = {
  year: 1, month: 2, day: 3,
  ctr: 5, orders: 6, cr: 7, costOrder: 8, aov: 9,
  totalSpend: 10, totalRevenue: 11, accountRevenue: 12, roas: 13,
  channels: {
    "Google Ads":  { spend:14, imp:15, click:16, trans:17, revenue:18, roas:19 },
    "Snapchat":    { spend:20, imp:21, click:22, trans:23, revenue:24, roas:25 },
    "Meta":        { spend:26, imp:27, click:28, trans:29, revenue:30, roas:31 },
    "Influencer":  { spend:44, imp:45, click:46, trans:47, revenue:48, roas:49 },
    "Whatsapp":    { spend:50, imp:51, click:52, trans:53, revenue:54, roas:55 }
  }
};

let RAW_ROWS = [];
let CHARTS = {};

// ====== أدوات مساعدة ======
const num = v => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[,٬\s%]/g,""));
  return isNaN(n) ? 0 : n;
};
const fmt = (n, d=0) => n.toLocaleString("en-US",{maximumFractionDigits:d});
const fmtMoney = n => fmt(n,0);

// ====== جلب البيانات ======
async function loadData() {
  const res = await fetch(SHEET_URL + "&_=" + Date.now());
  const text = await res.text();
  const parsed = Papa.parse(text, { skipEmptyLines: true });
  // أول صفين headers — نتجاوزهم
  const dataRows = parsed.data.slice(2).filter(r =>
    r[COL.day] && /\d{1,2}\/[A-Za-z]+\/\d{4}/.test(r[COL.day])
  );
  RAW_ROWS = dataRows;
  document.getElementById("lastUpdate").textContent =
    "آخر تحديث: " + new Date().toLocaleString("ar-EG");
  render();
}

// ====== فلترة الفترة ======
function filterByPeriod(rows) {
  const v = document.getElementById("periodFilter").value;
  if (v === "all") return rows;
  const days = v === "week" ? 7 : 30;
  return rows.slice(-days);
}

// ====== الرسم ======
function render() {
  const rows = filterByPeriod(RAW_ROWS);

  // === مجاميع KPI ===
  const totalSpend   = rows.reduce((s,r)=>s+num(r[COL.totalSpend]),0);
  const totalRevenue = rows.reduce((s,r)=>s+num(r[COL.totalRevenue]),0);
  const totalOrders  = rows.reduce((s,r)=>s+num(r[COL.orders]),0);
  const roas   = totalSpend ? totalRevenue/totalSpend : 0;
  const aov    = totalOrders ? totalRevenue/totalOrders : 0;
  const cpo    = totalOrders ? totalSpend/totalOrders : 0;
  const avgCtr = rows.reduce((s,r)=>s+num(r[COL.ctr]),0)/(rows.length||1);
  const avgCr  = rows.reduce((s,r)=>s+num(r[COL.cr]),0)/(rows.length||1);

  document.getElementById("kpiSpend").textContent   = fmtMoney(totalSpend);
  document.getElementById("kpiRevenue").textContent = fmtMoney(totalRevenue);
  document.getElementById("kpiRoas").textContent    = roas.toFixed(2)+"x";
  document.getElementById("kpiOrders").textContent  = fmtMoney(totalOrders);
  document.getElementById("kpiAov").textContent     = fmtMoney(aov);
  document.getElementById("kpiCr").textContent      = (avgCr*100).toFixed(2)+"%";
  document.getElementById("kpiCtr").textContent     = (avgCtr*100).toFixed(2)+"%";
  document.getElementById("kpiCpo").textContent     = fmtMoney(cpo);

  // === Trend Chart ===
  const labels = rows.map(r => r[COL.day]);
  const spendSeries   = rows.map(r => num(r[COL.totalSpend]));
  const revenueSeries = rows.map(r => num(r[COL.totalRevenue]));
  drawChart("trendChart","line",{
    labels,
    datasets:[
      {label:"Spend",   data:spendSeries,   borderColor:"#f87171", backgroundColor:"rgba(248,113,113,.15)", tension:.3, fill:true},
      {label:"Revenue", data:revenueSeries, borderColor:"#34d399", backgroundColor:"rgba(52,211,153,.15)", tension:.3, fill:true}
    ]
  });

  // === القنوات: مجاميع ===
  const channelTotals = {};
  for (const [name, c] of Object.entries(COL.channels)) {
    channelTotals[name] = {
      spend:   rows.reduce((s,r)=>s+num(r[c.spend]),0),
      imp:     rows.reduce((s,r)=>s+num(r[c.imp]),0),
      click:   rows.reduce((s,r)=>s+num(r[c.click]),0),
      trans:   rows.reduce((s,r)=>s+num(r[c.trans]),0),
      revenue: rows.reduce((s,r)=>s+num(r[c.revenue]),0)
    };
    channelTotals[name].roas = channelTotals[name].spend
      ? channelTotals[name].revenue/channelTotals[name].spend : 0;
  }

  const chNames = Object.keys(channelTotals);
  const palette = ["#38bdf8","#a78bfa","#f472b6","#fbbf24","#34d399"];

  drawChart("spendChannelChart","doughnut",{
    labels: chNames,
    datasets:[{ data: chNames.map(n=>channelTotals[n].spend), backgroundColor: palette }]
  });
  drawChart("revenueChannelChart","bar",{
    labels: chNames,
    datasets:[{ label:"Revenue", data: chNames.map(n=>channelTotals[n].revenue), backgroundColor:"#34d399" }]
  });
  drawChart("roasChannelChart","bar",{
    labels: chNames,
    datasets:[{ label:"ROAS", data: chNames.map(n=>+channelTotals[n].roas.toFixed(2)), backgroundColor:"#38bdf8" }]
  });

  // === الجدول ===
  const tbody = document.querySelector("#channelTable tbody");
  tbody.innerHTML = chNames.map(n=>{
    const c = channelTotals[n];
    return `<tr><td>${n}</td><td>${fmtMoney(c.spend)}</td><td>${fmtMoney(c.imp)}</td>
            <td>${fmtMoney(c.click)}</td><td>${fmtMoney(c.trans)}</td>
            <td>${fmtMoney(c.revenue)}</td><td>${c.roas.toFixed(2)}x</td></tr>`;
  }).join("");
}

function drawChart(id, type, data) {
  if (CHARTS[id]) CHARTS[id].destroy();
  const ctx = document.getElementById(id).getContext("2d");
  CHARTS[id] = new Chart(ctx, {
    type, data,
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:"#cbd5e1" } } },
      scales: type === "doughnut" ? {} : {
        x:{ ticks:{ color:"#94a3b8" }, grid:{ color:"#1e293b" } },
        y:{ ticks:{ color:"#94a3b8" }, grid:{ color:"#1e293b" } }
      }
    }
  });
}

document.getElementById("refreshBtn").addEventListener("click", loadData);
document.getElementById("periodFilter").addEventListener("change", render);

loadData();