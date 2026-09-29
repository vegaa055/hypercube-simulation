// A small control-panel builder. Every control reads its value through a
// getter on each refresh, so changes made elsewhere (autorotation, the gizmo,
// keyboard shortcuts) show up without extra wiring.

const SVG_NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;

export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

const plain = (html) => {
  const tmp = document.createElement('span');
  tmp.innerHTML = html;
  return tmp.textContent;
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export class Panel {
  constructor(parent) {
    this.el = el('aside', 'panel');
    this.el.setAttribute('aria-label', 'Controls');
    this.head = el('div', 'panel-head');
    this.body = el('div', 'panel-body');
    this.el.append(this.head, this.body);
    parent.append(this.el);
    this.watchers = [];
  }

  section(title, { open = true } = {}) {
    return new Section(this, title, open);
  }

  watch(fn) {
    this.watchers.push(fn);
    fn();
  }

  refresh() {
    for (const fn of this.watchers) fn();
  }
}

class Section {
  constructor(panel, title, open) {
    this.panel = panel;
    this.el = el('details', 'section');
    this.el.open = open;
    this.el.append(el('summary', 'section-title', title));
    this.body = el('div', 'section-body');
    this.el.append(this.body);
    panel.body.append(this.el);
  }

  add(node) {
    this.body.append(node);
    return node;
  }

  note(html) {
    return this.add(el('p', 'note', html));
  }

  // Disables a row whenever enabled() returns false.
  gate(row, enabled, inputs) {
    if (!enabled) return;
    let last;
    this.panel.watch(() => {
      const on = !!enabled();
      if (on === last) return;
      last = on;
      row.classList.toggle('is-disabled', !on);
      for (const input of inputs) input.disabled = !on;
    });
  }

  slider(label, { min, max, step, get, set, digits = 2, unit = '', enabled }) {
    const row = this.add(el('div', 'row slider-row'));
    const name = el('span', 'row-label', label);
    const range = el('input', 'range');
    Object.assign(range, { type: 'range', min, max, step });
    range.setAttribute('aria-label', plain(label));
    const num = el('input', 'num');
    Object.assign(num, { type: 'text', inputMode: 'decimal', spellcheck: false });
    num.setAttribute('aria-label', `${plain(label)} value`);
    row.append(name, range, num);

    let last;
    const format = (v) => `${v.toFixed(digits)}${unit}`;
    const sync = (force = false) => {
      const v = get();
      if (v === last && !force) return;
      last = v;
      if (+range.value !== v) range.value = v;
      range.style.setProperty('--fill', `${((clamp(v, min, max) - min) / (max - min)) * 100}%`);
      if (document.activeElement !== num || force) num.value = format(v);
    };
    range.addEventListener('input', () => {
      set(+range.value);
      sync(true);
    });
    num.addEventListener('change', () => {
      const v = parseFloat(num.value);
      if (Number.isFinite(v)) set(clamp(v, min, max));
      sync(true);
    });
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') num.blur();
      if (e.key === 'Escape') {
        sync(true);
        num.blur();
      }
    });
    num.addEventListener('focus', () => num.select());
    num.addEventListener('blur', () => sync(true));
    this.panel.watch(sync);
    this.gate(row, enabled, [range, num]);
    return row;
  }

  toggle(label, { get, set, enabled }) {
    const row = this.add(el('label', 'row toggle-row'));
    const input = el('input', 'switch');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    row.append(el('span', 'row-label', label), input);
    input.addEventListener('change', () => set(input.checked));
    this.panel.watch(() => {
      const v = !!get();
      if (input.checked !== v) input.checked = v;
    });
    this.gate(row, enabled, [input]);
    return row;
  }

  segmented(label, { options, get, set, enabled, stacked = false }) {
    const row = this.add(el('div', `row seg-row${label ? '' : ' is-bare'}${stacked ? ' is-stacked' : ''}`));
    const group = el('div', 'seg');
    group.setAttribute('role', 'group');
    if (label) {
      row.append(el('span', 'row-label', label));
      group.setAttribute('aria-label', plain(label));
    }
    const buttons = options.map((option) => {
      const button = el('button', 'seg-btn', option.label);
      button.type = 'button';
      button.addEventListener('click', () => set(option.value));
      group.append(button);
      return button;
    });
    row.append(group);
    let last;
    this.panel.watch(() => {
      const v = get();
      if (v === last) return;
      last = v;
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === v)));
    });
    this.gate(row, enabled, buttons);
    return row;
  }

  color(label, { get, set, enabled }) {
    const row = this.add(el('label', 'row color-row'));
    const input = el('input', 'swatch');
    input.type = 'color';
    row.append(el('span', 'row-label', label), input);
    input.addEventListener('input', () => set(input.value));
    this.panel.watch(() => {
      const v = get();
      if (input.value !== v) input.value = v;
    });
    this.gate(row, enabled, [input]);
    return row;
  }

  buttons(list) {
    const row = this.add(el('div', 'row btn-row'));
    for (const { label, onClick } of list) {
      const button = el('button', 'btn', label);
      button.type = 'button';
      button.addEventListener('click', onClick);
      row.append(button);
    }
    return row;
  }

  // One rotation plane: autorotate switch, speed slider and an angle dial.
  planeRow(label, { auto, speed, angle }) {
    const row = this.add(el('div', 'row plane-row'));
    const name = plain(label);

    const toggle = el('input', 'switch');
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', `Autorotate in the ${name} plane`);
    toggle.addEventListener('change', () => auto.set(toggle.checked));

    const range = el('input', 'range');
    Object.assign(range, { type: 'range', min: speed.min, max: speed.max, step: 1 });
    range.setAttribute('aria-label', `${name} speed, degrees per second`);
    range.addEventListener('input', () => speed.set(+range.value));

    const num = el('input', 'num');
    Object.assign(num, { type: 'text', inputMode: 'decimal', spellcheck: false });
    num.setAttribute('aria-label', `${name} speed value`);
    num.addEventListener('change', () => {
      const v = parseFloat(num.value);
      if (Number.isFinite(v)) speed.set(clamp(Math.round(v), speed.min, speed.max));
      last.speed = null;
    });
    num.addEventListener('keydown', (e) => e.key === 'Enter' && num.blur());
    num.addEventListener('focus', () => num.select());
    num.addEventListener('blur', () => (last.speed = null));

    const dial = createDial(name, angle);
    row.append(toggle, el('span', 'plane-label', label), range, num, dial.el);

    const last = { auto: null, speed: null };
    this.panel.watch(() => {
      const on = !!auto.get();
      if (on !== last.auto) {
        last.auto = on;
        toggle.checked = on;
        row.classList.toggle('is-off', !on);
      }
      const s = speed.get();
      if (s !== last.speed) {
        last.speed = s;
        range.value = s;
        const zero = -speed.min / (speed.max - speed.min);
        const at = (s - speed.min) / (speed.max - speed.min);
        range.style.setProperty('--from', `${Math.min(zero, at) * 100}%`);
        range.style.setProperty('--to', `${Math.max(zero, at) * 100}%`);
        if (document.activeElement !== num) num.value = `${s}°/s`;
      }
      dial.sync();
    });
    return row;
  }
}

// A draggable dial that shows and sets a rotation angle.
function createDial(name, { get, set }) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('class', 'dial');
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('role', 'slider');
  svg.setAttribute('aria-label', `${name} angle`);
  svg.setAttribute('aria-valuemin', '0');
  svg.setAttribute('aria-valuemax', '359');
  svg.innerHTML = `
    <title></title>
    <circle class="dial-ring" cx="16" cy="16" r="12.5"></circle>
    <path class="dial-arc"></path>
    <line class="dial-needle" x1="16" y1="16" x2="16" y2="5.5"></line>
    <circle class="dial-hub" cx="16" cy="16" r="1.8"></circle>`;
  const title = svg.querySelector('title');
  const arc = svg.querySelector('.dial-arc');
  const needle = svg.querySelector('.dial-needle');

  const wrap = (a) => ((a % TAU) + TAU) % TAU;
  const fromPointer = (e) => {
    const r = svg.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    set(wrap(Math.atan2(dx, -dy)));
  };

  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    svg.focus();
    fromPointer(e);
  });
  svg.addEventListener('pointermove', (e) => {
    if (svg.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  svg.addEventListener('dblclick', () => set(0));
  svg.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 45, PageDown: -45 }[e.key];
    if (step) set(wrap(get() + (step * Math.PI) / 180));
    else if (e.key === 'Home') set(0);
    else return;
    e.preventDefault();
  });

  let lastDeg = null;
  let lastRad = null;
  return {
    el: svg,
    sync() {
      const a = wrap(get());
      if (a === lastRad) return;
      lastRad = a;
      needle.setAttribute('transform', `rotate(${(a * 180) / Math.PI} 16 16)`);
      const r = 12.5;
      const x = 16 + r * Math.sin(a);
      const y = 16 - r * Math.cos(a);
      arc.setAttribute('d', a < 0.01 ? '' : `M16 3.5 A${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`);
      const deg = Math.round((a * 180) / Math.PI) % 360;
      if (deg !== lastDeg) {
        lastDeg = deg;
        svg.setAttribute('aria-valuenow', String(deg));
        svg.setAttribute('aria-valuetext', `${deg} degrees`);
        title.textContent = `${name}: ${deg}°. Drag to set, double-click to reset.`;
      }
    },
  };
}
