// Combined-account engine. Shared by the page (inlined at build) and the node check.
function jtEngine(DATA, entries){
  const DAY = 864e5;
  const toN = s => Math.round(Date.parse(s + 'T00:00:00Z') / DAY);
  const toS = n => new Date(n * DAY).toISOString().slice(0, 10);
  const accs = DATA.accounts;

  // JT #4 reference index, forward-filled by day
  const ref = accs.jt4, refStart = toN(ref.bal[0][0]);
  const refMap = new Map(ref.bal.map((p, i) => [toN(p[0]), 1 + ref.s[i] / 100]));

  // myfxbook accounts: daily balance + implied flows (same math myfxbook uses for Growth)
  const books = [];
  for (const [key, a] of Object.entries(accs)) {
    const bal = new Map(), flows = new Map();
    a.bal.forEach(([d, b], i) => {
      const prev = i ? a.bal[i - 1][1] * (1 + a.s[i] / 100) / (1 + a.s[i - 1] / 100) : 0;
      const f = b - prev;
      if (!i || Math.abs(f) > Math.max(200, 0.01 * Math.max(b, prev))) flows.set(toN(d), (flows.get(toN(d)) || 0) + (i ? f : b));
      bal.set(toN(d), b);
    });
    const last = a.bal[a.bal.length - 1];
    if (a.balNow < 1 && last[1] > 0) { const n = toN(last[0]) + 1; flows.set(n, -last[1]); bal.set(n, 0); }
    books.push({ key, name: a.name, url: a.url, verified: true, bal, flows, est: new Set() });
  }

  // Exchange: owner entries, gaps estimated on JT #4's day-by-day moves
  const ex = { key: 'exchange', name: 'Exchange account', verified: false, bal: new Map(), flows: new Map(), est: new Set() };
  const es = entries.slice().sort((x, y) => x.date < y.date ? -1 : 1);
  let lastRef = 1;
  const R = new Map();
  if (es.length) {
    const lo = toN(es[0].date), hi = toN(es[es.length - 1].date);
    for (let n = lo; n <= hi; n++) { if (refMap.has(n)) lastRef = refMap.get(n); R.set(n, lastRef); }
  }
  es.forEach((e, i) => {
    const n = toN(e.date);
    if (e.flow) ex.flows.set(n, (ex.flows.get(n) || 0) + e.flow);
    ex.bal.set(n, e.balance);
    const nx = es[i + 1]; if (!nx) return;
    const a = n, b = toN(nx.date), Va = e.balance, Vb = nx.balance - (nx.flow || 0);
    if (b - a < 2 || Va <= 0) return;
    const J = R.get(b) / R.get(a), pre = Math.max(0, Math.min(b, refStart) - a);
    const k = pre > 0 ? Math.pow(Vb / Va / J, 1 / pre) : Math.pow(Vb / Va / J, 1 / (b - a));
    for (let d = a + 1; d < b; d++) {
      const steps = pre > 0 ? Math.min(d, refStart) - a : d - a;
      ex.bal.set(d, Va * R.get(d) / R.get(a) * Math.pow(k, steps));
      ex.est.add(d);
    }
  });
  books.push(ex);

  // Daily grid
  let lo = Infinity, hi = -Infinity;
  for (const b of books) for (const n of b.bal.keys()) { lo = Math.min(lo, n); hi = Math.max(hi, n); }
  const days = [];
  const cur = new Map(books.map(b => [b.key, 0]));
  const stats = new Map(books.map(b => [b.key, { dep: 0, wd: 0 }]));
  let idx = 1, prevTot = 0, D = 0, W = 0;
  for (let n = lo; n <= hi; n++) {
    let F = 0, estDay = false;
    for (const b of books) {
      if (b.bal.has(n)) cur.set(b.key, b.bal.get(n));
      const f = b.flows.get(n) || 0;
      if (f) { F += f; const st = stats.get(b.key); if (f > 0) { st.dep += f; D += f; } else { st.wd -= f; W -= f; } }
      if (b.est.has(n)) estDay = true;
    }
    const tot = [...cur.values()].reduce((s, v) => s + v, 0);
    if (prevTot > 0) idx *= (tot - F) / prevTot;
    prevTot = tot;
    days.push({ d: toS(n), tot, idx, dep: D, wd: W, est: estDay || n < refStart });
  }
  const rows = books.map(b => ({ key: b.key, name: b.name, url: b.url, verified: b.verified, now: cur.get(b.key), ...stats.get(b.key) }));
  return { days, rows, now: prevTot, dep: D, wd: W, result: prevTot + W - D, firstReal: toS(refStart) };
}
if (typeof module !== 'undefined') module.exports = jtEngine;
