/* handoff-ready contract runtime — brings a legacy prototype up to the contract without
   rewriting it. It reads a declarative adapter (window.__UI_ADAPTER__) and:
     1. writes data-ui / data-ui-props / data-ui-slot / data-ui-nav-* attributes on every render,
     2. adds hash routing: #/<screen-id>?theme=<t> boots the app fresh and replays the
        screen's recipe, so every screen opens directly by URL.
   Loaded twice: once in <head> (boot phase: storage reset + theme) and once at the end of
   <body> (annotate + replay). Plain ES5 on purpose: it runs inside any prototype. */
(function () {
  'use strict';
  var A = window.__UI_ADAPTER__;
  if (!A) return;

  function parseRoute() {
    var h = location.hash.replace(/^#\/?/, '');
    if (!h || /^figmacapture=/.test(h)) return null;
    var q = h.indexOf('?');
    var id = q < 0 ? h : h.slice(0, q);
    var params = {};
    if (q >= 0) h.slice(q + 1).split('&').forEach(function (kv) {
      var p = kv.split('='); params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    return { id: id, theme: params.theme || A.defaultTheme || 'light', state: params.state || 'default' };
  }

  /* ── boot phase: runs in <head>, before the app reads its storage ── */
  if (!document.body) {
    var r = parseRoute();
    if (r && A.theme && A.theme.storageKey) {
      try {
        var seed = {}; seed[A.theme.field] = r.theme;
        (A.resetKeys || [A.theme.storageKey]).forEach(function (k) { localStorage.removeItem(k); });
        localStorage.setItem(A.theme.storageKey, JSON.stringify(seed));
      } catch (e) { /* private mode: the app falls back to its defaults */ }
    }
    if (r) document.documentElement.setAttribute('data-theme', r.theme);
    window.addEventListener('hashchange', function () { location.reload(); });
    return;
  }

  /* ── annotate phase ── */
  function test(el, cond) {
    if (cond === true || cond == null) return true;
    if (cond.charAt(0) === '>') return !!el.querySelector(':scope ' + cond);
    return el.matches(cond);
  }
  function resolveAxis(el, rules) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (typeof rule === 'string') return rule;           // trailing default
      if (test(el, rule[0])) return rule[1];
    }
    return 'default';
  }
  // icon names: the adapter carries { normalized svg markup: name } read from the prototype's
  // icon dictionaries, so every <svg> can say which glyph it draws (data-ui-icon)
  function hash(str) {
    var h = 5381;
    for (var k = 0; k < str.length; k++) h = ((h << 5) + h + str.charCodeAt(k)) >>> 0;
    return h.toString(36).slice(0, 6);
  }
  // a glyph turned by CSS (a chevron rotated to point left) is a different icon in Figma: the
  // capture bakes the turn into the vector, so the name carries it (chevron-r90)
  function turn(el) {
    var deg = 0;
    for (var n = el, k = 0; n && k < 2; n = n.parentElement, k++) {
      var t = getComputedStyle(n).transform;
      var m = t && t !== 'none' && t.match(/matrix\(([^,]+),\s*([^,]+)/);
      if (m) deg += Math.round(Math.atan2(parseFloat(m[2]), parseFloat(m[1])) * 180 / Math.PI);
    }
    deg = ((deg % 360) + 360) % 360;
    return deg ? '-r' + deg : '';
  }
  function iconKey(markup) {
    return markup.replace(/\s+/g, '').replace(/<\/\w+>/g, '').replace(/\/>/g, '>');
  }
  function annotate(root) {
    if (A.icons || true) {
      A.icons = A.icons || {};
      var svgs = root.querySelectorAll('svg');
      for (var j = 0; j < svgs.length; j++) {
        var key = iconKey(svgs[j].innerHTML);
        // inline glyphs outside any dictionary get a stable name from their markup
        var name = A.icons[key] || 'glyph-' + hash(key);
        if (svgs[j].getAttribute('data-ui-icon') !== name) svgs[j].setAttribute('data-ui-icon', name);
      }
    }
    (A.components || []).forEach(function (c) {
      var list = root.querySelectorAll(c.sel);
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        el.setAttribute('data-ui', c.ui);
        var props = [];
        Object.keys(c.props || {}).forEach(function (axis) {
          props.push(axis + '=' + resolveAxis(el, c.props[axis]));
        });
        if (props.length) el.setAttribute('data-ui-props', props.join(' '));
        Object.keys(c.slots || {}).forEach(function (slot) {
          var s = el.querySelector(c.slots[slot]);
          if (s) s.setAttribute('data-ui-slot', slot);
        });
      }
    });
    (A.sections || []).forEach(function (s) {
      var list = root.querySelectorAll(s.sel);
      for (var i = 0; i < list.length; i++) list[i].setAttribute('data-ui-section', s.name);
    });
    (A.nav || []).forEach(function (n) {
      var list = root.querySelectorAll(n.sel);
      for (var i = 0; i < list.length; i++) {
        list[i].setAttribute('data-ui-nav-type', n.type);
        if (n.target) list[i].setAttribute('data-ui-nav', n.target);
      }
    });
    var screen = document.querySelector(A.screenRoot || 'body');
    var r = parseRoute();
    if (screen && r) {
      screen.setAttribute('data-ui-screen', r.id);
      var meta = (A.screens || {})[r.id];
      if (meta) screen.setAttribute('data-ui-title', meta.title);
      screen.setAttribute('data-ui-screen-state', r.state);
    }
  }
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; observer.disconnect(); annotate(document); observe(); }, 0);
  }
  var observer = new MutationObserver(schedule);
  function observe() { observer.observe(document.body, { childList: true, subtree: true }); }

  /* ── replay phase: reach the screen of the route ── */
  window.Q = function (s) { return document.querySelector(s); };
  function click(e) { if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return e; }
  window.C = function (s) { return click(Q(s)); };
  window.CN = function (s, n) { return click(document.querySelectorAll(s)[n]); };
  window.CTXT = function (s, t) {
    var l = document.querySelectorAll(s);
    for (var i = 0; i < l.length; i++) if ((l[i].textContent || '').replace(/\s+/g, ' ').indexOf(t) >= 0) return click(l[i]);
    return null;
  };
  window.TYPE = function (s, v) {
    var e = Q(s); if (!e) return;
    var p = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value');
    if (p && p.set) p.set.call(e, v); else e.value = v;
    e.dispatchEvent(new Event('input', { bubbles: true }));
  };
  window.HOV = function (s) { var e = Q(s); if (e) e.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); };
  window.SCROLL = function (s) { var e = Q(s); if (e) e.scrollIntoView({ block: 'start' }); };

  function replay(recipe, done) {
    var steps = (recipe || '').split(/;(?=\s*(?:[A-Za-z_$]|$))/).map(function (s) { return s.trim(); }).filter(Boolean);
    (function next(i) {
      if (i >= steps.length) { document.documentElement.setAttribute('data-ui-ready', 'true'); return done && done(); }
      var r;
      try { r = (0, eval)(steps[i]); } catch (e) { console.warn('[ui-contract] step failed:', steps[i], e); }
      var go = function () { setTimeout(function () { next(i + 1); }, A.stepPause || 180); };
      // a step that returns a promise (waits for a reply, an animation) holds the replay until it settles
      if (r && typeof r.then === 'function') r.then(go, go); else go();
    })(0);
  }

  annotate(document);
  observe();
  var route = parseRoute();
  if (!route) {
    document.documentElement.setAttribute('data-ui-ready', 'true');
  } else if (route.id === '_components') {
    document.documentElement.setAttribute('data-ui-ready', 'true');
  } else {
    var s = (A.screens || {})[route.id];
    if (!s) { console.warn('[ui-contract] unknown screen', route.id); document.documentElement.setAttribute('data-ui-ready', 'true'); }
    else setTimeout(function () { replay(s.recipe); }, 250);
  }
  /* Capture tagging: html-to-design names each layer from the element's aria-label, so right
     before a capture every element gets a label that carries what the layer IS —
     [[ui:Name|props]] for a component root, [[icon:name]] for a glyph, [[section:x]], and
     [[n:class]] for any other box, plus [[to:screen]] on the element that leads to another
     screen. Figma-side scripts then read identity from layer names instead of guessing by
     geometry. Only ever run on a throwaway page load: it rewrites accessible names. */
  // the grid templates as the stylesheet wrote them: the browser reports every track in px, and
  // Figma needs to know which column was 1fr (grows), which was auto (fits its content) and which
  // was fixed. Last matching rule wins (source order; specificity is not weighed)
  var GRID_RULES = null;
  function gridRules() {
    if (GRID_RULES) return GRID_RULES;
    GRID_RULES = [];
    var visit = function (rules) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.cssRules && r.media) { if (window.matchMedia(r.media.mediaText).matches) visit(r.cssRules); continue; }
        if (r.cssRules && !r.selectorText) { visit(r.cssRules); continue; }
        if (!r.style || !r.selectorText) continue;
        var c = r.style.getPropertyValue('grid-template-columns'), w = r.style.getPropertyValue('grid-template-rows');
        if (c || w) GRID_RULES.push({ sel: r.selectorText, c: c, w: w });
      }
    };
    for (var s = 0; s < document.styleSheets.length; s++) { try { visit(document.styleSheets[s].cssRules); } catch (e) { /* cross-origin sheet */ } }
    return GRID_RULES;
  }
  function declared(el, prop) {
    var inline = el.style.getPropertyValue(prop === 'c' ? 'grid-template-columns' : 'grid-template-rows');
    if (inline) return inline;
    var rules = gridRules(), hit = '';
    for (var i = 0; i < rules.length; i++) { if (rules[i][prop]) { try { if (el.matches(rules[i].sel)) hit = rules[i][prop]; } catch (e) {} } }
    return hit;
  }
  // "minmax(0, 1fr) auto 120px" → "f1,h,x120": f = flexible (fr), h = fits its content, x = fixed px.
  // Null when the template can't be told track by track (auto-fill, subgrid, a var() of several tracks)
  function trackCodes(decl, computed) {
    if (!decl || /auto-fill|auto-fit|subgrid|masonry/.test(decl)) return null;
    var s = decl.replace(/\[[^\]]*\]/g, ' ').trim();
    for (var guard = 0; /repeat\(/.test(s) && guard < 10; guard++) {
      s = s.replace(/repeat\(\s*(\d+)\s*,\s*((?:[^()]|\([^()]*\))*)\)/, function (m, n, body) { var o = []; for (var k = 0; k < +n; k++) o.push(body.trim()); return o.join(' '); });
    }
    if (/repeat\(/.test(s)) return null;
    var toks = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (/\s/.test(ch) && depth === 0) { if (cur) toks.push(cur); cur = ''; } else cur += ch;
    }
    if (cur) toks.push(cur);
    var px = (computed || '').replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(function (x) { return /px$/.test(x); }).map(parseFloat);
    if (px.length && px.length !== toks.length) return null;
    return toks.map(function (t, k) {
      var fr = t.match(/^([\d.]+)fr$/) || t.match(/^minmax\([^,]+,\s*([\d.]+)fr\)$/);
      if (fr) return 'f' + (+fr[1]);
      if (/^(auto|min-content|max-content|fit-content\(.*\)|minmax\([^,]+,\s*(auto|max-content|min-content)\))$/.test(t)) return 'h';
      return 'x' + (px.length ? Math.round(px[k] * 10) / 10 : parseFloat(t) || 0);
    }).join(',');
  }
  // align-items / align-self → s, e, c, st, b ("safe center" aligns like center while it fits)
  var ALIGN = { stretch: 'st', normal: 'st', 'flex-start': 's', start: 's', 'self-start': 's', 'flex-end': 'e', end: 'e', 'self-end': 'e', center: 'c', baseline: 'b' };
  function alignCode(v) { return ALIGN[v.replace(/^(safe|unsafe)\s+/, '')]; }
  // "row wrap; gap 8px 6px; justify space-between; align center" → "rw:8,6:sb:c"
  function flexCode(cs) {
    var dir = /column/.test(cs.flexDirection) ? 'c' : 'r';
    var wrap = /wrap/.test(cs.flexWrap) && cs.flexWrap !== 'nowrap' ? 'w' : '';
    var cg = parseFloat(cs.columnGap) || 0, rg = parseFloat(cs.rowGap) || 0;
    var J = { 'flex-start': 's', start: 's', left: 's', normal: 's', 'flex-end': 'e', end: 'e', right: 'e', center: 'c', 'space-between': 'sb', 'space-around': 'sa', 'space-evenly': 'se' };
    return dir + wrap + ':' + Math.round(cg * 10) / 10 + ',' + Math.round(rg * 10) / 10 + ':' + (J[cs.justifyContent] || 's') + ':' + (alignCode(cs.alignItems) || 'st');
  }
  // an item that sits apart from its siblings on the cross axis (align-self: center in a column
  // that stretches, or auto margins that take the free space, which win over align-self): Figma
  // aligns every item of an auto layout the same way, so read-tags has to know which one differs.
  // Null for an item that sits like the rest, or for a box that is not an item
  function selfAlign(el, cs) {
    if (/^(absolute|fixed)$/.test(cs.position)) return null;
    var p = el.parentElement;
    while (p && getComputedStyle(p).display === 'contents') p = p.parentElement;
    var ps = p && getComputedStyle(p);
    if (!ps || !/flex|grid/.test(ps.display)) return null;
    // a grid item aligns on the vertical axis, inside its row. That is the cross axis of the auto
    // layout only for a grid of one row (it becomes a horizontal one); across several rows the
    // tag would name the wrong axis, or one where the item has nowhere to move
    if (/grid/.test(ps.display) && ps.gridTemplateRows.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).length > 1) return null;
    // computed styles resolve an auto margin to pixels; the typed OM still says 'auto'
    var m = el.computedStyleMap && el.computedStyleMap();
    var auto = function (side) { return !!m && String(m.get('margin-' + side)) === 'auto'; };
    var col = /flex/.test(ps.display) && /column/.test(ps.flexDirection);
    var lo = auto(col ? 'left' : 'top'), hi = auto(col ? 'right' : 'bottom');
    var own = lo || hi ? (lo && hi ? 'c' : lo ? 'e' : 's') : /^(auto|normal)$/.test(cs.alignSelf) ? null : alignCode(cs.alignSelf);
    // stretch only fills an item whose cross size is auto: one with a size of its own sits at the start
    if (own === 'st' && m && String(m.get(col ? 'width' : 'height')) !== 'auto') own = 's';
    if (!own || own === (alignCode(ps.alignItems) || 'st')) return null;
    // an item with no free room across (a width: 100% box whose max-width is wider, so its auto
    // margins came out 0) sits the same under any alignment: a tag would only make read-tags
    // add an 'align' frame. Within 1 px because clientWidth and clientHeight are whole pixels
    return own !== 'st' && Math.abs(freeAcross(el, cs, p, ps, col, lo, hi)) < 1 ? null : own;
  }
  // what the item's box and fixed margins leave of its parent's content box on the cross axis
  // (x across a column); an auto margin is that free room, so it does not count as the item's
  function freeAcross(el, cs, p, ps, col, lo, hi) {
    var S = col ? ['Left', 'Right'] : ['Top', 'Bottom'];
    var px = function (s, k) { return parseFloat(s[k]) || 0; };
    var b = el.getBoundingClientRect();
    var used = (col ? b.width : b.height) + (lo ? 0 : px(cs, 'margin' + S[0])) + (hi ? 0 : px(cs, 'margin' + S[1]));
    return (col ? p.clientWidth : p.clientHeight) - px(ps, 'padding' + S[0]) - px(ps, 'padding' + S[1]) - used;
  }
  // A box scrolled sideways (a timeline scrolled to today) pins its sticky column at an offset
  // that depends on the scroll: instances cannot share it, and a Figma frame cannot scroll back
  // to content left at a negative x. So the map and the capture both see every box at the start
  // of its x axis. Never y: a chat pane scrolled to its last message stays there. Any offset, not
  // only positive ones: a right-to-left box scrolls from 0 into negatives. 'instant' because a
  // box with scroll-behavior: smooth would still be moving when the map is measured
  function resetScroll() {
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) if (all[i].scrollLeft) all[i].scrollTo({ left: 0, behavior: 'instant' });
  }
  // room to 0.1 px, never below 0: whole-pixel client sizes can leave a hair of negative room
  function tenth(v) { return Math.max(0, Math.round(v * 10) / 10); }
  function tagForCapture(links) {
    resetScroll();
    var all = document.body.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|path|circle|rect|line|polyline|polygon|ellipse|g|defs|use)$/i.test(el.tagName)) continue;
      var tags = [];
      var ui = el.getAttribute('data-ui');
      if (ui) tags.push('ui:' + ui + (el.getAttribute('data-ui-props') ? '|' + el.getAttribute('data-ui-props') : ''));
      var icon = el.getAttribute('data-ui-icon');
      if (icon) tags.push('icon:' + icon + turn(el));
      var sec = el.getAttribute('data-ui-section');
      if (sec) tags.push('section:' + sec);
      var slot = el.getAttribute('data-ui-slot');
      if (slot) tags.push('slot:' + slot);
      if (!tags.length) tags.push('n:' + (el.id || (el.classList && el.classList[0]) || el.tagName.toLowerCase()));
      // the screen root says which screen this capture is: captures map to frames by name, not by order
      var scr = el.getAttribute('data-ui-screen');
      if (scr) tags.push('screen:' + scr);
      var cs = getComputedStyle(el);
      if (el.tagName.toLowerCase() !== 'svg') {
        // the scrollbar's room: the browser lays the content beside it, the capture over it;
        // read-tags gives the room back as padding. Overflow does not apply to an inline box: it
        // reports no client box, and its whole size would read as room
        var gY = 0, gX = 0;
        if ((el.clientWidth || el.clientHeight) && (/(auto|scroll)/.test(cs.overflowX + cs.overflowY) || /stable/.test(cs.scrollbarGutter))) {
          gY = el.offsetWidth - el.clientWidth - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0);
          gX = el.offsetHeight - el.clientHeight - (parseFloat(cs.borderTopWidth) || 0) - (parseFloat(cs.borderBottomWidth) || 0);
        }
        // a box that scrolls shows only its own size of its content: Figma clips it and scrolls it
        var sy = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4;
        var sx = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 4;
        if (sx || sy) {
          var sbY = sy ? gY : 0, sbX = sx ? gX : 0;
          tags.push('scroll:' + (sx ? 'x' : '') + (sy ? 'y' : '') + (sbY > 0 || sbX > 0 ? ':' + Math.max(0, Math.round(sbY)) + ',' + Math.max(0, Math.round(sbX)) : ''));
        }
        // the same room, whether the content overflows or not: scrollbar-gutter: stable keeps it
        // while everything fits, and then no scroll tag carries it. [right, bottom], then the
        // left side when there is one: both-edges keeps half the room on each side, and a
        // right-to-left box puts its bar on the left
        var gL = /both-edges/.test(cs.scrollbarGutter) ? gY / 2 : cs.direction === 'rtl' ? gY : 0;
        if (gY > 0.5 || gX > 0.5) tags.push('gut:' + tenth(gY - gL) + ',' + tenth(gX) + (gL > 0.5 ? ',' + tenth(gL) : ''));
        // a flex box as the stylesheet wrote it (direction, wrap, gaps, how it spreads and aligns its
        // items): the capture gives a row that wraps free layout; read-tags rebuilds it from this
        if (/flex/.test(cs.display)) tags.push('fx:' + flexCode(cs));
        // out of the flow: absolute (a), fixed (f), sticky (s) — a sticky label the capture left
        // absolute in the box that scrolls goes back to its row
        if (/^(absolute|fixed|sticky)$/.test(cs.position)) tags.push('pos:' + cs.position.charAt(0));
        if (/grid/.test(cs.display)) {
          var gc = trackCodes(declared(el, 'c'), cs.gridTemplateColumns);
          if (gc) tags.push('gc:' + gc);
          // rows nobody declared are sized by their content (grid-auto-rows: auto)
          var dr = declared(el, 'w');
          var gr = dr ? trackCodes(dr, cs.gridTemplateRows) : (cs.gridAutoRows === 'auto' ? '*h' : null);
          if (gr) tags.push('gr:' + gr);
        }
      }
      var as = selfAlign(el, cs);
      if (as) tags.push('as:' + as);
      // the element's own box: the capture wraps an element in frames of its own (its margins, an
      // auto margin that pushes it to the right) and repeats the label on them; the size says which
      // of those layers IS the element
      var bb = el.getBoundingClientRect();
      tags.push('wh:' + Math.round(bb.width * 10) / 10 + 'x' + Math.round(bb.height * 10) / 10);
      var label = el.getAttribute('aria-label');
      el.setAttribute('aria-label', '[[' + tags.join('][') + ']]' + (label ? ' ' + label : ''));
      if (el.tagName.toLowerCase() === 'svg') el.removeAttribute('aria-hidden');
    }
    (links || []).forEach(function (l) {
      var el = document.elementFromPoint(l.x, l.y);
      while (el && el !== document.body) {
        var b = el.getBoundingClientRect();
        if (Math.abs(b.width - l.w) < 2 && Math.abs(b.height - l.h) < 2) break;
        el = el.parentElement;
      }
      // replaced elements (img, svg, canvas) are not named from aria-label: tag their box
      while (el && el !== document.body && /^(IMG|CANVAS|VIDEO|svg)$/.test(el.tagName)) el = el.parentElement;
      if (el && el !== document.body) el.setAttribute('aria-label', el.getAttribute('aria-label').replace(/^\[\[/, '[[to:' + l.to + ']['));
    });
  }
  window.__UI_CONTRACT__ = { annotate: function () { annotate(document); }, route: parseRoute, replay: replay, tagForCapture: tagForCapture };
  // capture-batch resets before it measures the map, so the map and the capture agree
  window.__uiResetScroll = resetScroll;
})();
