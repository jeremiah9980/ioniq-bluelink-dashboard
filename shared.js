/* Shared helpers for the Ioniq 5 dashboard pages (Report, Diagnostics, Docs). */
(() => {
  const API = "https://api.github.com";
  const store = {
    get(k){ try { return localStorage.getItem("ioniq." + k) || ""; } catch { return ""; } },
  };
  const cfg = { repo: store.get("repo"), token: store.get("token") };
  const $ = (id) => document.getElementById(id);

  // ---------- GitHub
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
      cache: "no-store", ...opts,
      headers: { Authorization: "Bearer " + cfg.token, "X-GitHub-Api-Version": "2022-11-28",
                 Accept: "application/vnd.github+json", ...(opts.headers || {}) }
    });
    if (!res.ok) {
      let msg = res.status + " " + res.statusText;
      try { const j = await res.json(); if (j.message) msg = res.status + ": " + j.message; } catch {}
      const e = new Error(msg); e.status = res.status; throw e;
    }
    return res;
  }
  const raw = (file) => gh(`/repos/${cfg.repo}/contents/${file}?ref=status&t=${Date.now()}`,
                           { headers: { Accept: "application/vnd.github.raw+json" } });
  const rawJSON = (f) => raw(f).then(r => r.json());
  const rawText = (f) => raw(f).then(r => r.text());
  const parseJSONL = (txt) => (txt || "").split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  async function dispatch(action, extra = {}) {
    await gh(`/repos/${cfg.repo}/actions/workflows/command.yml/dispatches`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { action, ...extra } })
    });
  }

  // ---------- formatting
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const isNum = (v) => v !== null && v !== undefined && v !== "" && !isNaN(+v);
  const num = (v, d = 0) => isNum(v) ? (+v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }) : "–";
  const toDate = (v) => {
    if (v instanceof Date) return v;
    if (typeof v === "string" && /^\d{4}-\d\d-\d\d \d/.test(v)) v = v.replace(" ", "T").replace(/\.\d+$/, "");
    return new Date(v);
  };
  const fmtDT = (v) => { const d = toDate(v); return isNaN(d) ? "–" :
    d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
  const fmtD = (v) => { const d = toDate(v); return isNaN(d) ? "–" :
    d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
  const dayKey = (v) => { const d = toDate(v); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
  const dur = (min) => { if (!isNum(min)) return "–"; min = Math.round(min); const h = Math.floor(min/60), m = min%60; return h ? `${h}h ${m}m` : `${m}m`; };
  const ago = (iso) => {
    if (!iso) return "unknown"; const t = toDate(iso); if (isNaN(t)) return String(iso);
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "just now"; if (m < 60) return m + " min ago";
    const h = Math.round(m / 60); if (h < 36) return h + " hr ago";
    return fmtDT(t);
  };
  const yes = (v) => v === true || v === 1 || v === "true";
  const status = (kind, label) => {
    const icon = { good: "✓", warn: "⚠︎", bad: "⛔︎", na: "–" }[kind] || "";
    return `<span class="st ${kind}"><span aria-hidden="true">${icon}</span>${esc(label)}</span>`;
  };

  // ---------- CSV
  function downloadCSV(name, rows, cols) {
    const q = (v) => { v = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
    const csv = [cols.join(","), ...rows.map(r => cols.map(c => q(r[c])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- page chrome
  function nav(active) {
    const pages = [["index.html", "Remote"], ["report.html", "Report"], ["diagnostics.html", "Diagnostics"], ["docs.html", "Docs"]];
    const n = document.createElement("nav");
    n.className = "topnav"; n.setAttribute("aria-label", "Sections");
    n.innerHTML = pages.map(([href, label]) =>
      `<a href="${href}"${label === active ? ' aria-current="page"' : ""}>${label}</a>`).join("");
    document.body.prepend(n);
  }
  function banner(msg, err) {
    const b = $("banner"); if (!b) return;
    if (!msg) { b.style.display = "none"; return; }
    b.className = "banner" + (err ? " err" : ""); b.innerHTML = msg; b.style.display = "block";
  }
  let toastTimer;
  function toast(msg, ms = 4000) {
    let t = $("toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role","status"); document.body.appendChild(t); }
    t.textContent = msg; t.style.display = "block"; clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => (t.style.display = "none"), ms);
  }
  function needAuth() {
    if (cfg.repo && cfg.token) return false;
    banner('Not connected yet. Open <a href="index.html">Remote</a> → ⚙︎ Settings and add your repository and token. This page uses the same saved settings.');
    return true;
  }
  function apiError(e, what) {
    if (e.status === 401) banner("GitHub rejected the saved token. It may be wrong or expired. Replace it under <a href=\"index.html\">Remote → Settings</a>.", true);
    else if (e.status === 404) banner(`No ${esc(what)} found yet. The first status run creates it. Try again in a minute, or tap Update status on the Remote page.`);
    else banner(`Couldn't load ${esc(what)}: ${esc(e.message)}`, true);
  }

  // ---------- charts
  const NS = "http://www.w3.org/2000/svg";
  function niceTicks(min, max, n = 4) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
    for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(6));
    return out;
  }
  function timeTicks(t0, t1, width) {
    const n = Math.max(2, Math.min(7, Math.floor(width / 90)));
    const span = t1 - t0, out = [];
    for (let i = 0; i <= n; i++) out.push(t0 + (span * i) / n);
    const short = span < 36 * 3600e3;
    return out.map(t => ({ t, label: new Date(t).toLocaleString(undefined, short ? { hour: "numeric" } : { month: "short", day: "numeric" }) }));
  }
  function mountTip(el) { let tip = el.querySelector(".tip"); if (!tip) { tip = document.createElement("div"); tip.className = "tip"; el.appendChild(tip); } return tip; }

  /** Single-series line/area chart over time. pts: [{t: ms, v: number}] */
  function lineChart(el, pts, o = {}) {
    const draw = () => {
      el.innerHTML = "";
      pts = pts.filter(p => isNum(p.v)).sort((a, b) => a.t - b.t);
      if (pts.length < 2) { el.innerHTML = `<div class="empty">Not enough data in this range yet.</div>`; return; }
      const W = el.clientWidth || 600, H = o.height || 170, m = { l: 38, r: 10, t: 10, b: 24 };
      const vals = pts.map(p => +p.v);
      const yt = niceTicks(o.yMin ?? Math.min(...vals), o.yMax ?? Math.max(...vals), 4);
      const y0 = yt[0], y1 = yt[yt.length - 1];
      const t0 = o.t0 ?? pts[0].t, t1 = Math.max(o.t1 ?? pts[pts.length - 1].t, t0 + 1);
      const X = t => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
      const Y = v => m.t + (1 - (v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);
      const gap = o.gapMs ?? 6 * 3600e3;
      let d = "", segs = [], cur = [];
      pts.forEach((p, i) => { if (i && p.t - pts[i - 1].t > gap) { segs.push(cur); cur = []; } cur.push(p); });
      segs.push(cur);
      segs.forEach(s => { d += s.map((p, i) => (i ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(p.v).toFixed(1)).join(" ") + " "; });
      const area = o.area === false ? "" : segs.filter(s => s.length > 1).map(s =>
        `<path d="M${X(s[0].t)} ${Y(y0)} ${s.map(p => "L" + X(p.t).toFixed(1) + " " + Y(p.v).toFixed(1)).join(" ")} L${X(s[s.length - 1].t)} ${Y(y0)} Z" fill="${o.color || "var(--accent)"}" opacity=".12"/>`).join("");
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H);
      svg.setAttribute("role", "img"); svg.setAttribute("aria-label", o.label || "chart");
      const fmt = o.fmt || (v => num(v, 1) + (o.unit || ""));
      svg.innerHTML =
        yt.map(v => `<line class="${v === y0 ? "base" : "gridl"}" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>` +
          `<text class="ax" x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(num(v) + (o.axisUnit ?? o.unit ?? ""))}</text>`).join("") +
        timeTicks(t0, t1, W - m.l - m.r).map((tk, i, a) =>
          `<text class="ax" x="${X(tk.t)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === a.length - 1 ? "end" : "middle"}">${esc(tk.label)}</text>`).join("") +
        area + `<path d="${d}" fill="none" stroke="${o.color || "var(--accent)"}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<line class="cross" id="x" y1="${m.t}" y2="${H - m.b}" style="display:none"/>` +
        `<circle id="dot" r="4.5" fill="${o.color || "var(--accent)"}" stroke="var(--card)" stroke-width="2" style="display:none"/>` +
        `<rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" style="cursor:crosshair"/>`;
      el.prepend(svg);
      const tip = mountTip(el), cross = svg.querySelector("#x"), dot = svg.querySelector("#dot");
      const hide = () => { tip.style.display = cross.style.display = dot.style.display = "none"; };
      svg.querySelector("rect").addEventListener("pointermove", ev => {
        const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) * (W / r.width);
        const tt = t0 + ((sx - m.l) / (W - m.l - m.r)) * (t1 - t0);
        let lo = 0, hi = pts.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; pts[mid].t < tt ? (lo = mid) : (hi = mid); }
        const p = Math.abs(pts[lo].t - tt) < Math.abs(pts[hi].t - tt) ? pts[lo] : pts[hi];
        const px = X(p.t), py = Y(p.v);
        cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.style.display = "";
        dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.style.display = "";
        tip.innerHTML = `<b>${esc(fmt(p.v))}</b> · ${esc(fmtDT(p.t))}${p.note ? "<br>" + esc(p.note) : ""}`;
        tip.style.left = (px / W) * r.width + "px"; tip.style.top = (py / H) * r.height + "px"; tip.style.display = "block";
      });
      svg.querySelector("rect").addEventListener("pointerleave", hide);
    };
    draw();
    if (!el._ro) { el._ro = new ResizeObserver(() => { clearTimeout(el._rt); el._rt = setTimeout(draw, 120); }); el._ro.observe(el); }
    el._redraw = (newPts, newO) => { pts = newPts; o = newO || o; draw(); };
  }

  /** Stacked vertical bars. rows: [{label, parts:[n,...]}], series: [{name, color}] */
  function stackedBars(el, rows, series, o = {}) {
    const draw = () => {
      el.innerHTML = "";
      if (!rows.length) { el.innerHTML = `<div class="empty">No trips recorded in this range.</div>`; return; }
      const W = el.clientWidth || 600, H = o.height || 190, m = { l: 38, r: 8, t: 10, b: 24 };
      const totals = rows.map(r => r.parts.reduce((a, b) => a + (+b || 0), 0));
      const yt = niceTicks(0, Math.max(...totals, 0.1), 4), y1 = yt[yt.length - 1];
      const Y = v => m.t + (1 - v / y1) * (H - m.t - m.b);
      const slot = (W - m.l - m.r) / rows.length, bw = Math.max(3, Math.min(34, slot * 0.66));
      const every = Math.ceil(rows.length / Math.max(2, Math.floor((W - m.l) / 64)));
      let bars = "";
      rows.forEach((r, i) => {
        const cx = m.l + slot * i + slot / 2; let acc = 0;
        r.parts.forEach((v, k) => {
          v = +v || 0; if (v <= 0) return;
          const yTop = Y(acc + v), yBot = Y(acc); acc += v;
          const h = Math.max(0, yBot - yTop - (acc - v > 0 ? 2 : 0));   // 2px surface gap between segments
          const isTop = r.parts.slice(k + 1).every(x => !(+x > 0));
          bars += isTop
            ? `<path d="M${cx - bw/2} ${yTop + h} V${yTop + 4} Q${cx - bw/2} ${yTop} ${cx - bw/2 + 4} ${yTop} H${cx + bw/2 - 4} Q${cx + bw/2} ${yTop} ${cx + bw/2} ${yTop + 4} V${yTop + h} Z" fill="${series[k].color}"/>`
            : `<rect x="${cx - bw/2}" y="${yTop}" width="${bw}" height="${h}" fill="${series[k].color}"/>`;
        });
        bars += `<rect data-i="${i}" x="${m.l + slot * i}" y="${m.t}" width="${slot}" height="${H - m.t - m.b}" fill="transparent"/>`;
      });
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H);
      svg.setAttribute("role", "img"); svg.setAttribute("aria-label", o.label || "bar chart");
      svg.innerHTML = yt.map(v => `<line class="${v === 0 ? "base" : "gridl"}" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>` +
          `<text class="ax" x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(num(v, 1))}</text>`).join("") +
        rows.map((r, i) => i % every ? "" : `<text class="ax" x="${m.l + slot * i + slot / 2}" y="${H - 6}" text-anchor="middle">${esc(r.label)}</text>`).join("") + bars;
      el.prepend(svg);
      const tip = mountTip(el);
      svg.querySelectorAll("rect[data-i]").forEach(hit => {
        hit.addEventListener("pointerenter", () => {
          const i = +hit.dataset.i, r = rows[i], box = svg.getBoundingClientRect();
          tip.innerHTML = `<b>${esc(r.title || r.label)}</b>` + series.map((s, k) =>
            `<br><span class="sw" style="background:${s.color}"></span>${esc(s.name)}: <b>${num(r.parts[k], 2)}</b> ${esc(o.unit || "")}`).join("") +
            `<br>Total: <b>${num(totals[i], 2)}</b> ${esc(o.unit || "")}`;
          tip.style.left = ((m.l + slot * i + slot / 2) / W) * box.width + "px";
          tip.style.top = (Y(totals[i]) / H) * box.height + "px"; tip.style.display = "block";
        });
        hit.addEventListener("pointerleave", () => (tip.style.display = "none"));
      });
    };
    draw();
    if (!el._ro) { el._ro = new ResizeObserver(() => { clearTimeout(el._rt); el._rt = setTimeout(draw, 120); }); el._ro.observe(el); }
    el._redraw = (r2) => { rows = r2; draw(); };
  }

  window.IQ = { cfg, gh, raw, rawJSON, rawText, parseJSONL, dispatch, esc, num, isNum, toDate, fmtDT, fmtD, dayKey, dur, ago,
                yes, status, downloadCSV, nav, banner, toast, needAuth, apiError, lineChart, stackedBars };
})();
