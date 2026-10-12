// Small Grafana-style time-series panels on canvas: lines, threshold lines, annotations, hover crosshair.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function createPanel(root, { title, series, unit, max }) {
  const el = document.createElement('div');
  el.className = 'panel';
  el.innerHTML = `<div class="panel-head"><span class="panel-title">${title}</span><span class="legend">${series
    .map((s, i) => `<span><i style="background:var(--series-${i + 1})"></i>${s[1]}</span>`)
    .join('')}</span></div><div class="plot"><canvas></canvas><div class="tip" hidden></div></div>`;
  root.appendChild(el);
  const canvas = el.querySelector('canvas');
  const tip = el.querySelector('.tip');
  let hoverX = null;
  let last = null;
  canvas.addEventListener('mousemove', (e) => { hoverX = e.offsetX; draw(last); });
  canvas.addEventListener('mouseleave', () => { hoverX = null; tip.hidden = true; draw(last); });

  function fmt(v) {
    if (v == null || Number.isNaN(v)) return '-';
    const n = Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
    return unit === '%' ? `${n}%` : unit ? `${n} ${unit}` : n;
  }

  function draw(data) {
    if (!data) return;
    last = data;
    const { samples, now, windowS, thresholds = [], annotations = [] } = data;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = 44, padR = 8, padT = 6, padB = 18;
    const t0 = Math.max(0, now - windowS), t1 = Math.max(windowS, now);
    const vis = samples.filter((s) => s.t >= t0);
    let top = max ?? 0;
    if (max == null) {
      for (const s of vis) for (const [k] of series) top = Math.max(top, s[k]);
      for (const th of thresholds) top = Math.max(top, th.value * 1.15);
      top = niceCeil(top || 1);
    }
    const x = (t) => padL + ((t - t0) / (t1 - t0)) * (w - padL - padR);
    const y = (v) => padT + (1 - v / top) * (h - padT - padB);

    // Grid and axes (recessive)
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = css('--text-muted');
    ctx.strokeStyle = css('--grid');
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const v = (top / 4) * i, yy = Math.round(y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(short(v), padL - 6, yy + 3);
    }
    ctx.textAlign = 'center';
    const stepT = windowS / 5;
    for (let t = Math.ceil(t0 / stepT) * stepT; t <= t1; t += stepT) if (x(t) < w - padR - 16) ctx.fillText(clock(t), x(t), h - 4);

    // Annotations (deploys, changes) as dashed verticals
    ctx.setLineDash([3, 3]);
    for (const a of annotations) {
      if (a.t < t0 || a.t > now) continue;
      ctx.strokeStyle = a.kind === 'deploy' ? css('--annot-deploy') : css('--annot-change');
      ctx.beginPath(); ctx.moveTo(Math.round(x(a.t)) + 0.5, padT); ctx.lineTo(Math.round(x(a.t)) + 0.5, h - padB); ctx.stroke();
    }
    // Alert thresholds
    for (const th of thresholds) {
      ctx.strokeStyle = th.severity === 'critical' ? css('--critical') : css('--warning');
      ctx.beginPath(); ctx.moveTo(padL, y(th.value)); ctx.lineTo(w - padR, y(th.value)); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Series
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    series.forEach(([k], i) => {
      ctx.strokeStyle = css(`--series-${i + 1}`);
      ctx.beginPath();
      vis.forEach((s, j) => (j ? ctx.lineTo(x(s.t), y(Math.min(s[k], top))) : ctx.moveTo(x(s.t), y(Math.min(s[k], top)))));
      ctx.stroke();
    });

    // Hover crosshair + tooltip
    if (hoverX != null && vis.length) {
      const t = t0 + ((hoverX - padL) / (w - padL - padR)) * (t1 - t0);
      const s = vis.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
      ctx.strokeStyle = css('--text-muted');
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x(s.t)) + 0.5, padT); ctx.lineTo(Math.round(x(s.t)) + 0.5, h - padB); ctx.stroke();
      series.forEach(([k], i) => {
        ctx.fillStyle = css(`--series-${i + 1}`);
        ctx.beginPath(); ctx.arc(x(s.t), y(Math.min(s[k], top)), 4, 0, Math.PI * 2); ctx.fill();
      });
      tip.hidden = false;
      tip.innerHTML = `<b>T+${clock(s.t)}</b>` + series.map(([k, label], i) => `<div><i style="background:var(--series-${i + 1})"></i>${label}<span>${fmt(s[k])}</span></div>`).join('');
      const left = Math.min(x(s.t) + 12, w - tip.offsetWidth - 4);
      tip.style.left = `${Math.max(4, left)}px`;
    }
  }

  return { draw };
}

function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function short(v) { return v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${+v.toFixed(v < 10 ? 1 : 0)}`; }
export function clock(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
