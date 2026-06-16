/* PACYO dev server: serves the static site and saves inline edits back to index.html.
   The /save endpoint patches only the inner content of editable elements, leaving the
   rest of the file byte-for-byte unchanged. */

var http = require('http');
var fs = require('fs');
var path = require('path');
var parse = require('node-html-parser').parse;

var ROOT = __dirname;
var INDEX = path.join(ROOT, 'index.html');
var PORT = process.env.PORT ? Number(process.env.PORT) : 4173;

// Must match the EDITABLE selector list in app.js, in the same order.
var EDITABLE = [
  'main h1', 'main h2', 'main h3',
  'main p',
  'main .when', 'main .what', 'main .where',
  'main .venue', 'main .tag', 'main .role', 'main .label', 'main .value',
  'main .date strong', 'main .date span', 'main .program-meta',
  '.foot-line', '.foot-fine'
].join(', ');

// Must match the REMOVABLE selector list in app.js, in the same order.
// Whole blocks and repeatable list items the editor can delete.
var REMOVABLE = [
  'main .hero', 'main .section', 'main .two-col', 'main .prose',
  'main .cta-row', 'main .contact-block', 'main .end-note',
  'main .upcoming li', 'main .teasers li', 'main .value-rows li',
  'main .people li', 'main .program-rows li', 'main .concert-rows li',
  'main .detail-rows li'
].join(', ');

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Locate the inner-content character range of an element within the source string.
function innerRange(html, el) {
  var start = el.range[0];
  var end = el.range[1];
  var src = html.slice(start, end);
  var openEnd = src.indexOf('>');          // end of the opening tag
  var closeStart = src.lastIndexOf('<');   // start of the closing tag
  if (openEnd === -1 || closeStart === -1 || closeStart < openEnd) return null;
  return { from: start + openEnd + 1, to: start + closeStart };
}

// Draggable blocks: the direct element children of every panel's .wrap.
// The client enumerates the same set in the same order (`.panel > .wrap > *`).
function arrangeables(root) {
  var out = [];
  root.querySelectorAll('.panel .wrap').forEach(function (w) {
    w.childNodes.forEach(function (n) { if (n.nodeType === 1) out.push(n); });
  });
  return out;
}

// Patch the opening tag of an element to set (or clear) a single attribute.
function attrPatch(html, el, name, value) {
  var start = el.range[0];
  var src = html.slice(start, el.range[1]);
  var gt = src.indexOf('>');
  if (gt === -1) return null;
  var open = src.slice(0, gt);
  var re = new RegExp('\\s' + name + '\\s*=\\s*("[^"]*"|\'[^\']*\')');
  var m = re.exec(open);
  var next;
  if (value === '' || value == null) {
    next = m ? (open.slice(0, m.index) + open.slice(m.index + m[0].length)) : open;
  } else {
    var attr = ' ' + name + '="' + String(value).replace(/"/g, '&quot;') + '"';
    next = m ? (open.slice(0, m.index) + attr + open.slice(m.index + m[0].length)) : (open + attr);
  }
  return { from: start, to: start + gt, value: next };
}

// Grow a deletion range to swallow the element's leading indentation and its
// trailing line break, so removing a block doesn't leave a blank line behind.
function expandLineRange(html, from, to) {
  var s = from;
  while (s > 0 && (html[s - 1] === ' ' || html[s - 1] === '\t')) s--;
  var e = to;
  if (html[e] === '\r') e++;
  if (html[e] === '\n') e++;
  return { from: s, to: e };
}

function applySave(html, payload) {
  var edits = payload.edits || {};
  var removed = payload.removed || [];
  var styles = payload.styles || {};        // { 'a3': 'position:absolute;left:..;top:..' }
  var root = parse(html, { comment: true });
  var editEls = root.querySelectorAll(EDITABLE);
  var remEls = root.querySelectorAll(REMOVABLE);
  var arrEls = arrangeables(root);

  // Full ranges of the elements being removed.
  var removedRanges = [];
  remEls.forEach(function (el, i) {
    if (removed.indexOf('r' + i) === -1) return;
    removedRanges.push({ from: el.range[0], to: el.range[1] });
  });
  // Keep only outermost ranges (drop any fully contained in another removal).
  var outer = removedRanges.filter(function (r) {
    return !removedRanges.some(function (o) {
      return o !== r && o.from <= r.from && o.to >= r.to && (o.from < r.from || o.to > r.to);
    });
  });
  function insideRemoved(from, to) {
    return outer.some(function (o) { return o.from <= from && o.to >= to; });
  }

  var ops = [];
  outer.forEach(function (r) {
    var x = expandLineRange(html, r.from, r.to);
    ops.push({ from: x.from, to: x.to, value: '' });
  });
  editEls.forEach(function (el, i) {
    var key = 'f' + i;
    if (!Object.prototype.hasOwnProperty.call(edits, key)) return;
    var r = innerRange(html, el);
    if (!r) return;
    if (insideRemoved(r.from, r.to)) return; // its block is being deleted
    ops.push({ from: r.from, to: r.to, value: String(edits[key]) });
  });
  // Inline position/style on draggable blocks.
  arrEls.forEach(function (el, i) {
    var key = 'a' + i;
    if (!Object.prototype.hasOwnProperty.call(styles, key)) return;
    if (insideRemoved(el.range[0], el.range[1])) return;
    var p = attrPatch(html, el, 'style', styles[key]);
    if (p) ops.push(p);
  });
  // Font: custom CSS overrides and the web-font link.
  if (typeof payload.customCss === 'string') {
    var styleEl = root.querySelector('#pacyo-custom');
    if (styleEl) {
      var ir = innerRange(html, styleEl);
      if (ir) ops.push({ from: ir.from, to: ir.to, value: payload.customCss });
    }
  }
  if (typeof payload.fontLink === 'string') {
    var linkEl = root.querySelector('#pacyo-font');
    if (linkEl) {
      var lp = attrPatch(html, linkEl, 'href', payload.fontLink);
      if (lp) ops.push(lp);
    }
  }

  // Apply from the end so earlier offsets stay valid.
  ops.sort(function (a, b) { return b.from - a.from; });
  ops.forEach(function (p) {
    html = html.slice(0, p.from) + p.value + html.slice(p.to);
  });
  return { html: html, removed: outer.length };
}

function serveFile(res, filePath) {
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

var server = http.createServer(function (req, res) {
  if (req.method === 'POST' && req.url === '/save') {
    var body = '';
    req.on('data', function (chunk) {
      body += chunk;
      if (body.length > 5e6) req.destroy(); // guard against runaway payloads
    });
    req.on('end', function () {
      try {
        var payload = JSON.parse(body);
        var html = fs.readFileSync(INDEX, 'utf8');
        var result = applySave(html, payload);
        fs.writeFileSync(INDEX, result.html);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, removed: result.removed }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      }
    });
    return;
  }

  // Static files. Disallow path traversal; only serve files inside ROOT.
  var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  var filePath = path.normalize(path.join(ROOT, urlPath));
  if (filePath.indexOf(ROOT) !== 0) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  serveFile(res, filePath);
});

server.listen(PORT, function () {
  console.log('PACYO dev server on http://localhost:' + PORT + ' (edits save to index.html)');
});
