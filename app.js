(function () {
  var panels = document.querySelectorAll('.panel');
  var tabs = document.querySelectorAll('.site-head nav a[data-tab]');

  var titles = {
    home: 'PACYO · Palo Alto Community Youth Orchestra',
    about: 'About · PACYO',
    programs: 'Programs · PACYO',
    concerts: 'Concerts · PACYO',
    auditions: 'Auditions · PACYO'
  };

  function route() {
    var id = location.hash.replace('#', '') || 'home';
    if (!titles[id]) id = 'home';

    panels.forEach(function (panel) {
      var match = panel.dataset.panel === id;
      panel.classList.toggle('active', match);
      panel.hidden = !match;
    });

    tabs.forEach(function (tab) {
      if (tab.dataset.tab === id) {
        tab.setAttribute('aria-current', 'page');
      } else {
        tab.removeAttribute('aria-current');
      }
    });

    document.title = titles[id];
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route();

  /* ---------- inline text editor ---------- */

  var STORE_KEY = 'pacyo-edits-v2';
  var RESUME_KEY = 'pacyo-editing'; // resume edit mode after a removal-triggered reload
  var EDITABLE = [
    'main h1', 'main h2', 'main h3',
    'main p',
    'main .when', 'main .what', 'main .where',
    'main .venue', 'main .tag', 'main .role', 'main .label', 'main .value',
    'main .date strong', 'main .date span', 'main .program-meta',
    '.foot-line', '.foot-fine'
  ].join(', ');

  var fields = Array.prototype.slice.call(document.querySelectorAll(EDITABLE));

  // Stable key per field, based on document order, so edits survive reloads.
  fields.forEach(function (el, i) {
    el.setAttribute('data-editable', '');
    el.setAttribute('data-edit-key', 'f' + i);
  });

  // Removable blocks: whole sections and repeatable list items the editor can delete.
  // Must match the REMOVABLE list in server.js, in the same order.
  var REMOVABLE = [
    'main .hero', 'main .section', 'main .two-col', 'main .prose',
    'main .cta-row', 'main .contact-block', 'main .end-note',
    'main .upcoming li', 'main .teasers li', 'main .value-rows li',
    'main .people li', 'main .program-rows li', 'main .concert-rows li',
    'main .detail-rows li'
  ].join(', ');

  var removableEls = Array.prototype.slice.call(document.querySelectorAll(REMOVABLE));
  var removed = {}; // remove-keys deleted this session

  removableEls.forEach(function (el, i) {
    el.setAttribute('data-remove-key', 'r' + i);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remove-btn';
    btn.title = 'Remove this block';
    btn.setAttribute('aria-label', 'Remove this block');
    btn.textContent = '×';
    // Don't steal focus from a field being edited.
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      removed[el.getAttribute('data-remove-key')] = true;
      if (el.parentNode) el.parentNode.removeChild(el);
      scheduleSave();
    });
    el.appendChild(btn);
  });

  var toggle = document.getElementById('edit-toggle');
  var label = toggle.querySelector('.edit-label');
  var editing = false;
  var saveTimer = null;
  var statusTimer = null;
  var dirty = {};          // keys of fields the user has actually edited
  var pendingStyles = {};  // arrange-key -> inline style string, awaiting save
  var pendingFont = null;  // { customCss, fontLink } awaiting save

  // Read a field's inner HTML without the injected editor controls.
  function cleanInner(el) {
    var clone = el.cloneNode(true);
    var ctrls = clone.querySelectorAll('.drag-handle, .remove-btn, .snap-guide');
    Array.prototype.forEach.call(ctrls, function (c) { c.parentNode.removeChild(c); });
    return clone.innerHTML;
  }

  // Collect only edited fields, keyed by their stable edit key, so saves touch
  // only what changed and leave the rest of index.html untouched.
  function collectEdits() {
    var map = {};
    fields.forEach(function (el) {
      var key = el.getAttribute('data-edit-key');
      if (dirty[key]) map[key] = cleanInner(el);
    });
    return map;
  }

  function setLabel(text) {
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    label.textContent = text;
  }

  // Persist edits to index.html via the dev server. Falls back to localStorage
  // if the server (or its /save endpoint) isn't available.
  function persist() {
    var edits = collectEdits();
    var rem = Object.keys(removed);
    var styles = pendingStyles;
    var hasStyles = Object.keys(styles).length > 0;
    var font = pendingFont;
    if (!Object.keys(edits).length && !rem.length && !hasStyles && !font) {
      label.textContent = editing ? 'Done' : 'Edit text';
      return;
    }

    var payload = { edits: edits, removed: rem, styles: styles };
    if (font) { payload.customCss = font.customCss; payload.fontLink = font.fontLink; }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)); } catch (e) {}

    var hadRemovals = rem.length > 0;

    setLabel('Saving…');
    fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('save failed');
      return res.json();
    }).then(function () {
      pendingStyles = {};
      pendingFont = null;
      // A removal changes element order in the file, which invalidates the
      // index-based keys. Reload to re-sync; edit mode resumes automatically.
      if (hadRemovals) {
        removed = {};
        dirty = {};
        try { sessionStorage.setItem(RESUME_KEY, '1'); } catch (e) {}
        location.reload();
        return;
      }
      setLabel('Saved ✓');
      statusTimer = setTimeout(function () {
        label.textContent = editing ? 'Done' : 'Edit text';
      }, 1400);
    }).catch(function () {
      setLabel('Save failed');
      statusTimer = setTimeout(function () {
        label.textContent = editing ? 'Done' : 'Edit text';
      }, 2200);
    });
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 700);
  }

  fields.forEach(function (el) {
    el.addEventListener('input', function () {
      dirty[el.getAttribute('data-edit-key')] = true;
      scheduleSave();
    });
  });

  function canEdit() {
    return window.matchMedia('(min-width: 860px)').matches;
  }

  function setEditing(on) {
    if (on && !canEdit()) on = false; // editing is desktop-only
    editing = on;
    document.body.classList.toggle('editing', on);
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    fields.forEach(function (el) {
      el.contentEditable = on ? 'true' : 'false';
    });
    try {
      if (on) sessionStorage.setItem(RESUME_KEY, '1');
      else sessionStorage.removeItem(RESUME_KEY);
    } catch (e) {}
    if (on) {
      setLabel('Done');
    } else {
      // Flush any pending edit and save on the way out of edit mode.
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      persist();
    }
  }

  toggle.addEventListener('click', function () {
    setEditing(!editing);
  });

  /* ---------- move / drag with snap guides ---------- */

  // Draggable blocks = direct children of every panel's .wrap (matches server).
  var arrangeEls = [];
  document.querySelectorAll('.panel > .wrap').forEach(function (w) {
    Array.prototype.forEach.call(w.children, function (c) { arrangeEls.push(c); });
  });

  arrangeEls.forEach(function (el, i) {
    el.setAttribute('data-arrange-key', 'a' + i);
    var h = document.createElement('button');
    h.type = 'button';
    h.className = 'drag-handle';
    h.title = 'Drag to move this block';
    h.setAttribute('aria-label', 'Drag to move this block');
    h.textContent = '⠿';
    h.addEventListener('pointerdown', function (e) { startDrag(e, el); });
    el.appendChild(h);
  });

  var drag = {};
  var guideEls = [];
  var SNAP = 6;

  function clearGuides() {
    guideEls.forEach(function (g) { if (g.parentNode) g.parentNode.removeChild(g); });
    guideEls = [];
  }

  function wrapHeight(wrap) {
    var max = 0;
    Array.prototype.forEach.call(wrap.children, function (k) {
      if (k.hasAttribute('data-arrange-key') && k.style.position === 'absolute') {
        var t = parseFloat(k.style.top) || 0;
        max = Math.max(max, t + k.getBoundingClientRect().height);
      }
    });
    return max;
  }

  function fitWrap(wrap) {
    wrap.style.height = Math.round(wrapHeight(wrap) + 48) + 'px';
  }

  // Freeze every block in a wrap at its current spot so the layout doesn't jump
  // the moment the user starts dragging one of them.
  function pinWrap(wrap) {
    if (wrap.dataset.pinned) return;
    var kids = Array.prototype.filter.call(wrap.children, function (c) {
      return c.hasAttribute('data-arrange-key');
    });
    var wr = wrap.getBoundingClientRect();
    var measures = kids.map(function (k) {
      var r = k.getBoundingClientRect();
      return { el: k, left: r.left - wr.left, top: r.top - wr.top, width: r.width };
    });
    wrap.style.position = 'relative';
    wrap.style.height = Math.round(wr.height) + 'px';
    measures.forEach(function (m) {
      m.el.style.position = 'absolute';
      m.el.style.margin = '0';
      m.el.style.left = Math.round(m.left) + 'px';
      m.el.style.top = Math.round(m.top) + 'px';
      m.el.style.width = Math.round(m.width) + 'px';
      pendingStyles[m.el.getAttribute('data-arrange-key')] = m.el.getAttribute('style');
    });
    wrap.dataset.pinned = '1';
  }

  function snapTargets(wrap, el) {
    var cs = getComputedStyle(wrap);
    var pl = parseFloat(cs.paddingLeft) || 0;
    var pr = parseFloat(cs.paddingRight) || 0;
    var W = wrap.getBoundingClientRect().width;
    var xs = [pl, W / 2, W - pr];
    var ys = [];
    Array.prototype.forEach.call(wrap.children, function (k) {
      if (k === el || !k.hasAttribute('data-arrange-key') || k.style.position !== 'absolute') return;
      var l = parseFloat(k.style.left) || 0;
      var t = parseFloat(k.style.top) || 0;
      var r = k.getBoundingClientRect();
      xs.push(l, l + r.width / 2, l + r.width);
      ys.push(t, t + r.height / 2, t + r.height);
    });
    return { xs: xs, ys: ys };
  }

  function snap(left, top, w, h, t) {
    var bx = { d: SNAP + 1 }, by = { d: SNAP + 1 };
    [['l', left], ['c', left + w / 2], ['r', left + w]].forEach(function (e) {
      t.xs.forEach(function (x) { var d = Math.abs(e[1] - x); if (d < bx.d) bx = { d: d, x: x, k: e[0] }; });
    });
    [['t', top], ['m', top + h / 2], ['b', top + h]].forEach(function (e) {
      t.ys.forEach(function (y) { var d = Math.abs(e[1] - y); if (d < by.d) by = { d: d, y: y, k: e[0] }; });
    });
    var out = { left: left, top: top, v: [], h: [] };
    if (bx.x !== undefined && bx.d <= SNAP) {
      out.left = bx.k === 'l' ? bx.x : bx.k === 'c' ? bx.x - w / 2 : bx.x - w;
      out.v.push(bx.x);
    }
    if (by.y !== undefined && by.d <= SNAP) {
      out.top = by.k === 't' ? by.y : by.k === 'm' ? by.y - h / 2 : by.y - h;
      out.h.push(by.y);
    }
    return out;
  }

  function drawGuides(wrap, vs, hs) {
    clearGuides();
    var r = wrap.getBoundingClientRect();
    vs.forEach(function (x) {
      var g = document.createElement('div');
      g.className = 'snap-guide v';
      g.style.left = x + 'px';
      g.style.height = r.height + 'px';
      wrap.appendChild(g);
      guideEls.push(g);
    });
    hs.forEach(function (y) {
      var g = document.createElement('div');
      g.className = 'snap-guide h';
      g.style.top = y + 'px';
      g.style.width = r.width + 'px';
      wrap.appendChild(g);
      guideEls.push(g);
    });
  }

  function startDrag(e, el) {
    if (!editing || !canEdit()) return;
    e.preventDefault();
    e.stopPropagation();
    var wrap = el.parentNode;
    pinWrap(wrap);
    var r = el.getBoundingClientRect();
    drag = {
      el: el, wrap: wrap,
      sx: e.clientX, sy: e.clientY,
      ox: parseFloat(el.style.left) || 0,
      oy: parseFloat(el.style.top) || 0,
      w: r.width, h: r.height,
      targets: snapTargets(wrap, el)
    };
    el.classList.add('dragging');
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', endDrag);
  }

  function onDrag(e) {
    if (!drag.el) return;
    var left = drag.ox + (e.clientX - drag.sx);
    var top = drag.oy + (e.clientY - drag.sy);
    var s = snap(left, top, drag.w, drag.h, drag.targets);
    drag.el.style.left = Math.round(s.left) + 'px';
    drag.el.style.top = Math.round(s.top) + 'px';
    drawGuides(drag.wrap, s.v, s.h);
  }

  function endDrag() {
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', endDrag);
    if (drag.el) {
      drag.el.classList.remove('dragging');
      Array.prototype.forEach.call(drag.wrap.children, function (k) {
        if (k.hasAttribute('data-arrange-key') && k.style.position === 'absolute') {
          pendingStyles[k.getAttribute('data-arrange-key')] = k.getAttribute('style');
        }
      });
      fitWrap(drag.wrap);
      scheduleSave();
    }
    clearGuides();
    drag = {};
  }

  // On load, re-establish the positioning context for any wrap whose blocks
  // were previously dragged (their inline positions come from the saved file).
  function initLayout() {
    document.querySelectorAll('.panel > .wrap').forEach(function (w) {
      var hasAbs = Array.prototype.some.call(w.children, function (c) {
        return c.hasAttribute('data-arrange-key') && c.style.position === 'absolute';
      });
      if (hasAbs) {
        w.style.position = 'relative';
        w.dataset.pinned = '1';
        fitWrap(w);
      }
    });
  }
  window.addEventListener('hashchange', initLayout);
  initLayout();

  /* ---------- font pairings ---------- */

  var FONT_PAIRINGS = {
    'fraunces-inter': {
      link: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=Inter:wght@400;500;600&display=swap',
      serif: '"Fraunces", Georgia, "Times New Roman", serif',
      sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
    },
    'playfair-source': {
      link: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..700;1,400..600&family=Source+Sans+3:wght@400;500;600&display=swap',
      serif: '"Playfair Display", Georgia, serif',
      sans: '"Source Sans 3", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif'
    },
    'space-inter': {
      link: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap',
      serif: '"Space Grotesk", system-ui, sans-serif',
      sans: '"Inter", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif'
    },
    'libre-inter': {
      link: 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600&display=swap',
      serif: '"Libre Baskerville", Georgia, serif',
      sans: '"Inter", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif'
    },
    'georgia-system': {
      link: '',
      serif: 'Georgia, "Times New Roman", serif',
      sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'
    }
  };

  var fontSelect = document.getElementById('font-select');
  var fontLinkEl = document.getElementById('pacyo-font');
  var customEl = document.getElementById('pacyo-custom');

  function applyFont(id) {
    var p = FONT_PAIRINGS[id];
    if (!p) return;
    if (fontLinkEl) fontLinkEl.href = p.link;
    if (customEl) customEl.textContent = '/* font: ' + id + ' */ :root{--serif:' + p.serif + ';--sans:' + p.sans + ';}';
  }

  if (fontSelect) {
    // Reflect the currently-saved pairing in the dropdown.
    var saved = /font:\s*([\w-]+)/.exec((customEl && customEl.textContent) || '');
    if (saved && FONT_PAIRINGS[saved[1]]) fontSelect.value = saved[1];

    fontSelect.addEventListener('change', function () {
      applyFont(fontSelect.value);
      pendingFont = {
        customCss: customEl ? customEl.textContent : '',
        fontLink: fontLinkEl ? (fontLinkEl.getAttribute('href') || '') : ''
      };
      scheduleSave();
    });
  }

  /* ---------- reset to default ---------- */

  // Clears every customization this editor can make: block positions (back to
  // normal flow) and the font (back to the default pairing). Text content and
  // deletions are left untouched.
  function resetToDefault() {
    arrangeEls.forEach(function (el) {
      el.removeAttribute('style');
      pendingStyles[el.getAttribute('data-arrange-key')] = '';
    });
    document.querySelectorAll('.panel > .wrap').forEach(function (w) {
      w.style.position = '';
      w.style.height = '';
      delete w.dataset.pinned;
    });
    clearGuides();
    if (fontLinkEl) fontLinkEl.setAttribute('href', '');
    if (customEl) customEl.textContent = '';
    if (fontSelect) fontSelect.value = 'fraunces-inter';
    pendingFont = { customCss: '', fontLink: '' };
    scheduleSave();
  }

  var resetBtn = document.getElementById('reset-default');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (window.confirm('Reset the font and all block positions to the default layout? Your text stays as it is.')) {
        resetToDefault();
      }
    });
  }

  /* ---------- admin login ---------- */

  var ADMIN_PASSWORD = 'PACYOTest2026';
  var ADMIN_KEY = 'pacyo-admin';

  var adminToggle = document.getElementById('admin-toggle');
  var adminDialog = document.getElementById('admin-dialog');
  var adminForm = document.getElementById('admin-form');
  var adminPassword = document.getElementById('admin-password');
  var adminError = document.getElementById('admin-error');
  var adminCancel = document.getElementById('admin-cancel');

  function isAdmin() {
    return document.body.classList.contains('admin');
  }

  function setAdmin(on) {
    document.body.classList.toggle('admin', on);
    adminToggle.textContent = on ? 'Log out of admin' : 'Admin login';
    if (!on) setEditing(false);
  }

  try {
    setAdmin(sessionStorage.getItem(ADMIN_KEY) === '1');
    // Resume edit mode if we just reloaded after a removal.
    if (isAdmin() && sessionStorage.getItem(RESUME_KEY) === '1') setEditing(true);
  } catch (e) {}

  adminToggle.addEventListener('click', function () {
    if (isAdmin()) {
      try { sessionStorage.removeItem(ADMIN_KEY); } catch (e) {}
      setAdmin(false);
      return;
    }
    adminForm.reset();
    adminError.hidden = true;
    adminDialog.showModal();
  });

  adminForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (adminPassword.value === ADMIN_PASSWORD) {
      try { sessionStorage.setItem(ADMIN_KEY, '1'); } catch (e) {}
      setAdmin(true);
      adminDialog.close();
    } else {
      adminError.hidden = false;
      adminPassword.select();
    }
  });

  adminCancel.addEventListener('click', function () {
    adminDialog.close();
  });

  // While editing, don't let links inside editable text navigate away.
  document.addEventListener('click', function (e) {
    if (!editing) return;
    var link = e.target.closest('[data-editable] a, a[data-editable]');
    if (link) e.preventDefault();
  });
})();
