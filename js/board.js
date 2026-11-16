// Тактическая схема на SVG: фишки игроков, стрелки движения и подписи.
const NS = 'http://www.w3.org/2000/svg';
export const W = 1000, H = 625;
export const ARROW_COLORS = ['#ff2e4d', '#ffd23f', '#3fd0ff', '#7dff6a', '#ffffff'];

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const initials = (s) => (s || '?').trim().slice(0, 2).toUpperCase();

export class Board {
  /**
   * @param {SVGSVGElement} svg
   * @param {{readOnly?:boolean, tokenInfo:(uid:string)=>{label:string,color:string,me?:boolean}|null, onChange?:()=>void}} opts
   */
  constructor(svg, opts) {
    this.svg = svg;
    this.opts = opts;
    this.mode = 'move';
    this.color = ARROW_COLORS[0];
    this.phase = { positions: {}, arrows: [], labels: [] };
    this.image = null;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.classList.add('board');
    if (!opts.readOnly) this.bind();
  }

  setData(phase, image) {
    this.phase = phase;
    phase.positions = phase.positions || {};
    phase.arrows = phase.arrows || [];
    phase.labels = phase.labels || [];
    this.image = image || null;
    this.render();
  }

  setMode(m) { this.mode = m; this.svg.dataset.mode = m; }

  pt(e) {
    const p = this.svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const r = p.matrixTransform(this.svg.getScreenCTM().inverse());
    return { x: clamp(Math.round(r.x), 0, W), y: clamp(Math.round(r.y), 0, H) };
  }

  changed() { this.render(); this.opts.onChange && this.opts.onChange(); }

  render() {
    const s = this.svg;
    s.innerHTML = '';
    const defs = el('defs', {}, s);
    const pat = el('pattern', { id: 'grid', width: 50, height: 50, patternUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: 'M 50 0 L 0 0 0 50', fill: 'none', stroke: 'rgba(255,255,255,.06)', 'stroke-width': 1 }, pat);
    ARROW_COLORS.forEach((c, i) => {
      const m = el('marker', { id: 'ah' + i, viewBox: '0 0 10 10', refX: 7, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,0 L10,5 L0,10 z', fill: c }, m);
    });

    el('rect', { x: 0, y: 0, width: W, height: H, fill: '#0d0b12' }, s);
    if (this.image) {
      el('image', { href: this.image, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'xMidYMid meet' }, s);
      el('rect', { x: 0, y: 0, width: W, height: H, fill: 'rgba(0,0,0,.15)' }, s);
    }
    el('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#grid)' }, s);

    this.phase.arrows.forEach((a, i) => {
      const ci = Math.max(0, ARROW_COLORS.indexOf(a.c));
      const g = el('g', { class: 'arrow', 'data-arrow': i }, s);
      el('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: 'transparent', 'stroke-width': 22 }, g);
      el('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: ARROW_COLORS[ci], 'stroke-width': 5, 'stroke-linecap': 'round', 'marker-end': `url(#ah${ci})`, 'stroke-dasharray': a.dash ? '14 10' : '' }, g);
    });

    this.phase.labels.forEach((l, i) => {
      const g = el('g', { class: 'label', 'data-label': i, transform: `translate(${l.x},${l.y})` }, s);
      const t = el('text', { x: 0, y: 6, 'text-anchor': 'middle', class: 'label-text' }, g);
      t.textContent = l.t;
      const w = Math.max(40, l.t.length * 10 + 20);
      const bg = el('rect', { x: -w / 2, y: -15, width: w, height: 30, rx: 6, class: 'label-bg' });
      g.insertBefore(bg, t);
    });

    for (const [uid, p] of Object.entries(this.phase.positions)) {
      const info = this.opts.tokenInfo(uid);
      if (!info) continue;
      const g = el('g', { class: 'token' + (info.me ? ' me' : ''), 'data-token': uid, transform: `translate(${p.x},${p.y})` }, s);
      if (info.me) el('circle', { r: 31, class: 'token-halo' }, g);
      el('circle', { r: 24, fill: info.color, class: 'token-body' }, g);
      const t = el('text', { y: 7, 'text-anchor': 'middle', class: 'token-initials' }, g);
      t.textContent = initials(info.label);
      const n = el('text', { y: 44, 'text-anchor': 'middle', class: 'token-name' }, g);
      n.textContent = info.label;
    }

    if (this.temp) {
      const ci = Math.max(0, ARROW_COLORS.indexOf(this.color));
      el('line', { ...this.temp, stroke: this.color, 'stroke-width': 5, 'stroke-linecap': 'round', 'marker-end': `url(#ah${ci})`, opacity: .7 }, s);
    }
  }

  bind() {
    const s = this.svg;
    s.addEventListener('pointerdown', (e) => {
      const p = this.pt(e);
      const tok = e.target.closest('[data-token]');
      const arr = e.target.closest('[data-arrow]');
      const lab = e.target.closest('[data-label]');
      if (this.mode === 'erase') {
        if (tok) delete this.phase.positions[tok.dataset.token];
        else if (arr) this.phase.arrows.splice(+arr.dataset.arrow, 1);
        else if (lab) this.phase.labels.splice(+lab.dataset.label, 1);
        else return;
        this.changed();
        return;
      }
      if (this.mode === 'move' && (tok || lab)) {
        e.preventDefault();
        s.setPointerCapture(e.pointerId);
        const target = tok ? this.phase.positions[tok.dataset.token] : this.phase.labels[+lab.dataset.label];
        this.drag = { target, dx: target.x - p.x, dy: target.y - p.y, tok: !!tok };
        return;
      }
      if (this.mode === 'arrow') {
        e.preventDefault();
        s.setPointerCapture(e.pointerId);
        this.temp = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        this.render();
        return;
      }
      if (this.mode === 'label') {
        const t = prompt('Текст подписи (например: «Точка сбора», «Опасно», «Цель»)');
        if (t && t.trim()) { this.phase.labels.push({ x: p.x, y: p.y, t: t.trim().slice(0, 40) }); this.changed(); }
      }
    });
    s.addEventListener('pointermove', (e) => {
      if (!this.drag && !this.temp) return;
      const p = this.pt(e);
      if (this.drag) {
        const m = this.drag.tok ? 30 : 0; // фишке нужно место под ник
        this.drag.target.x = clamp(p.x + this.drag.dx, m, W - m);
        this.drag.target.y = clamp(p.y + this.drag.dy, m, H - (this.drag.tok ? 52 : 0));
      } else { this.temp.x2 = p.x; this.temp.y2 = p.y; }
      this.render();
    });
    const end = () => {
      if (this.drag) { this.drag = null; this.changed(); }
      if (this.temp) {
        const t = this.temp; this.temp = null;
        if (Math.hypot(t.x2 - t.x1, t.y2 - t.y1) > 15) this.phase.arrows.push({ ...t, c: this.color, dash: !!this.dash });
        this.changed();
      }
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
  }

  addToken(uid) {
    const n = Object.keys(this.phase.positions).length;
    this.phase.positions[uid] = { x: 80 + (n % 8) * 110, y: H - 70 - Math.floor(n / 8) * 90 };
    this.changed();
  }
}
