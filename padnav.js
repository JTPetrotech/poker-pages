/* PadNav - drive a page's menus with a game controller.
 *
 * One file, shared by the Arcade and every game on it. Each repo carries its
 * own copy because each game ships as one self-contained page; the master is
 * hub/src/padnav.js, so change it there and copy it out.
 *
 *   D-pad / left stick   move between buttons, links and fields
 *   A (Cross)            press the highlighted thing
 *   B (Circle)           back: presses a Back/Close/Cancel button, else Escape
 *   Start (Options)      PadNav.onStart, else Escape
 *   Right stick          scroll
 *   Left / right on a slider or a dropdown changes its value
 *
 * It only reads buttons while PadNav.active() says a menu is up, so a game
 * that already uses A for "shoot" sets that hook and the two never fight:
 *
 *   PadNav.active  = function(){ return G.phase !== 'play'; };
 *   PadNav.onStart = function(){ togglePause(); };   // called in play too
 *   PadNav.root    = function(){ return el('ovPause'); };  // optional fence
 *
 * Anything else that should be reachable, a clickable <div>, gets data-pad.
 * data-pad-default marks where focus lands first; data-pad-back marks the
 * control B should press.
 */
(function(){
  'use strict';
  if (window.PadNav) return;

  var PN = window.PadNav = {
    active: function(){ return true; },
    onStart: null,
    onBack: null,
    root: null,
    /* true from the first press on a controller until the mouse moves */
    using: false
  };

  var SEL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,' +
            '[tabindex]:not([tabindex="-1"]),[data-pad],[role=button]';
  /* Only words that undo: never "quit", "leave" or "exit", which B must not
     be able to do by accident. */
  var BACK_RE = /^\s*(?:[←‹<]\s*)?(back|close|cancel|resume|not now)\b|^\s*[×✕✖]\s*$/i;

  var css = document.createElement('style');
  css.textContent =
    '.pn-focus{outline:3px solid #ffd34d!important;outline-offset:3px!important;' +
    'box-shadow:0 0 0 7px rgba(255,211,77,.28)!important;transition:outline-color .1s}' +
    '#pn-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;' +
    'background:rgba(10,12,16,.92);color:#fff;font:600 14px/1.35 system-ui,sans-serif;' +
    'padding:10px 16px;border-radius:10px;border:1px solid rgba(255,211,77,.5);' +
    'pointer-events:none;opacity:0;transition:opacity .25s;max-width:90vw;text-align:center}' +
    '#pn-toast.on{opacity:1}';
  (document.head || document.documentElement).appendChild(css);

  /* ------------------------------------------------------------ finding -- */

  function isFixedLayer(node){
    for (var n = node; n && n !== document.body; n = n.parentElement)
      if (getComputedStyle(n).position === 'fixed') return n;
    return null;
  }

  function scrollParent(el){
    for (var n = el.parentElement; n && n !== document.body; n = n.parentElement){
      var o = getComputedStyle(n);
      if (/(auto|scroll|hidden)/.test(o.overflowY + o.overflowX)) return n;
    }
    return null;
  }

  function hitOk(el, x, y){
    var hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    if (hit === el || el.contains(hit)) return true;
    var lab = hit.closest && hit.closest('label');
    return !!(lab && lab.contains(el)) || (el.labels && Array.prototype.indexOf.call(el.labels, lab) >= 0);
  }

  /* Can a person see and press this right now? The hit test is what keeps
     focus out of a menu that an overlay is sitting on top of. */
  function usable(el){
    if (el.disabled || el.closest('[inert],[aria-hidden="true"],[hidden]')) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var sp = scrollParent(el);
    if (sp){
      var pr = sp.getBoundingClientRect();
      /* scrolled out of its box: fine, as long as the box itself is showing */
      if (cy < pr.top || cy > pr.bottom || cx < pr.left || cx > pr.right){
        var px = Math.min(Math.max(cx, pr.left + 2), pr.right - 2);
        var py = Math.min(Math.max(cy, pr.top + 2), pr.bottom - 2);
        return px >= 0 && py >= 0 && px < innerWidth && py < innerHeight && hitOk(sp, px, py);
      }
    }
    if (cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) return hitOk(el, cx, cy);
    /* below the fold of the page: reachable unless a fixed overlay owns the screen */
    var mid = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    var layer = mid && isFixedLayer(mid);
    return !layer || layer.contains(el);
  }

  function scopeEl(){
    var r = typeof PN.root === 'function' ? PN.root() : PN.root;
    if (r) return r;
    var dialogs = document.querySelectorAll('dialog[open]');
    return dialogs.length ? dialogs[dialogs.length - 1] : document;
  }

  function candidates(){
    var all = scopeEl().querySelectorAll(SEL), out = [];
    for (var i = 0; i < all.length; i++) if (usable(all[i])) out.push(all[i]);
    return out;
  }

  /* ------------------------------------------------------------- focus -- */

  var cur = null, curKey = '', curX = 0, curY = 0;

  function keyOf(el){
    return el.id ? '#' + el.id : el.tagName + '|' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40);
  }

  function mark(el){
    if (cur && cur !== el) cur.classList.remove('pn-focus');
    cur = el;
    if (!el) return;
    var r = el.getBoundingClientRect();
    curKey = keyOf(el); curX = r.left + r.width / 2; curY = r.top + r.height / 2;
    if (!el.matches('a[href],button,input,select,textarea,summary,[tabindex]')) el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    el.classList.add('pn-focus');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function first(list){
    for (var i = 0; i < list.length; i++) if (list[i].hasAttribute('data-pad-default')) return list[i];
    for (i = 0; i < list.length; i++) if (list[i].hasAttribute('autofocus')) return list[i];
    var a = document.activeElement;
    if (a && list.indexOf(a) >= 0) return a;
    return list[0];
  }

  function current(list){
    if (cur && list.indexOf(cur) >= 0) return cur;
    /* Pages that redraw (a poker table every time someone acts) swap the
       highlighted button for a fresh copy. Pick the copy back up - same id or
       label, else whatever now sits nearest where it was - rather than
       starting over in the top corner. */
    if (cur && !cur.isConnected){
      var best = null, bestD = Infinity;
      for (var i = 0; i < list.length; i++){
        if (keyOf(list[i]) === curKey){ best = list[i]; break; }
        var r = list[i].getBoundingClientRect();
        var d = Math.hypot(r.left + r.width / 2 - curX, r.top + r.height / 2 - curY);
        if (d < bestD && d < 160){ bestD = d; best = list[i]; }
      }
      if (best){ mark(best); return best; }
    }
    var a = document.activeElement;
    return a && list.indexOf(a) >= 0 ? a : null;
  }

  /* Spatial: nearest thing in the pressed direction, with sideways drift
     costing extra so a column of buttons is walked straight down. */
  function move(dx, dy){
    var list = candidates();
    if (!list.length) return;
    var from = current(list);
    if (!from){ mark(first(list)); return; }

    if (dx && adjust(from, dx)) return;

    var a = from.getBoundingClientRect();
    var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    /* First only what lies that way; if that finds nothing, up and down
       settle for the nearest row even when it sits off to one side. */
    var best = pickDir(list, from, a, ax, ay, dx, dy, true);
    if (!best && dy) best = pickDir(list, from, a, ax, ay, dx, dy, false);
    if (best) mark(best);
  }

  function pickDir(list, from, a, ax, ay, dx, dy, cone){
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++){
      var c = list[i];
      if (c === from || c.contains(from) || from.contains(c)) continue;
      var b = c.getBoundingClientRect();
      var bx = b.left + b.width / 2, by = b.top + b.height / 2;
      var along, side;
      if (dx){
        if ((bx - ax) * dx <= 4) continue;
        along = dx > 0 ? b.left - a.right : a.left - b.right;
        side = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
      } else {
        if ((by - ay) * dy <= 4) continue;
        along = dy > 0 ? b.top - a.bottom : a.top - b.bottom;
        side = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      }
      /* nothing that way at all beats a leap to the far corner of the page */
      var off = Math.abs(dx ? by - ay : bx - ax), ahead = Math.abs(dx ? bx - ax : by - ay);
      if (cone && side > 0 && off > ahead * 1.2) continue;
      var score = Math.max(along, 0) + side * 2.5 + off * 0.15;
      if (score < bestScore){ bestScore = score; best = c; }
    }
    return best;
  }

  function fire(el, type){ el.dispatchEvent(new Event(type, { bubbles: true })); }

  /* Left/right on a slider or a dropdown changes it instead of leaving it. */
  function adjust(el, dir){
    if (el.tagName === 'INPUT' && el.type === 'range'){
      var step = parseFloat(el.step) || 1;
      var span = (parseFloat(el.max) || 100) - (parseFloat(el.min) || 0);
      if (span / step > 40) step = span / 40;       // big ranges move in 40 stops
      var before = el.value;
      el.value = String(parseFloat(el.value) + dir * step);
      if (el.value !== before){ fire(el, 'input'); fire(el, 'change'); }
      return true;
    }
    if (el.tagName === 'SELECT' && el.options.length){
      var i = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + dir));
      if (i !== el.selectedIndex){ el.selectedIndex = i; fire(el, 'input'); fire(el, 'change'); }
      return true;
    }
    return false;
  }

  function press(){
    var list = candidates();
    var el = current(list);
    if (!el){ if (list.length) mark(first(list)); return; }
    if (el.tagName === 'SELECT'){
      el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
      fire(el, 'input'); fire(el, 'change');
      return;
    }
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/.test(el.type))){
      el.focus(); if (el.select) el.select();
      return;
    }
    el.click();
  }

  function key(code){
    var t = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
    var k = code === 'Escape' ? 'Escape' : code;
    t.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: code, bubbles: true, cancelable: true }));
    t.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: code, bubbles: true, cancelable: true }));
  }

  function back(){
    if (PN.onBack && PN.onBack() !== false) return;
    var list = candidates();
    for (var i = 0; i < list.length; i++){
      var c = list[i];
      var label = (c.getAttribute('aria-label') || c.textContent || c.value || '').trim();
      if (c.hasAttribute('data-pad-back') || BACK_RE.test(label)){ c.click(); return; }
    }
    key('Escape');
  }

  /* ------------------------------------------------------------- toast -- */

  var toast = null, toastT = 0;
  function say(msg){
    if (!document.body) return;
    if (!toast){ toast = document.createElement('div'); toast.id = 'pn-toast'; document.body.appendChild(toast); }
    toast.textContent = msg;
    toast.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function(){ toast.classList.remove('on'); }, 3800);
  }
  var greeted = false;

  /* ------------------------------------------------------------- polling -- */
  /* The Gamepad API has no button events, so every pad is read each frame. */

  var prev = {};             // pad index -> array of pressed flags
  var held = null, repeatAt = 0, wasAct = true;

  function pressed(gp, i){ var b = gp.buttons[i]; return !!(b && (b.pressed || b.value > 0.5)); }

  function tick(now){
    requestAnimationFrame(tick);
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    var act = false;
    try { act = !!PN.active() && !document.pointerLockElement; } catch (e) { act = false; }
    var dirX = 0, dirY = 0, scroll = 0;
    var edges = {};

    for (var p = 0; p < pads.length; p++){
      var gp = pads[p];
      if (!gp || !gp.connected) continue;
      var was = prev[p] || [], now_ = [];
      for (var b = 0; b < gp.buttons.length; b++){
        now_[b] = pressed(gp, b);
        if (now_[b] && !was[b]) edges[b] = true;
      }
      prev[p] = now_;
      var lx = gp.axes[0] || 0, ly = gp.axes[1] || 0, ry = gp.axes[3] || 0;
      if (now_[14] || lx < -0.55) dirX = -1;
      if (now_[15] || lx > 0.55) dirX = 1;
      if (now_[12] || ly < -0.55) dirY = -1;
      if (now_[13] || ly > 0.55) dirY = 1;
      if (Math.abs(ry) > 0.2) scroll = ry;
    }

    var anyEdge = false; for (var e in edges){ anyEdge = true; break; }
    if (anyEdge && !greeted && act){
      greeted = true;
      say('Controller ready — D-pad to move, A to select, B to go back');
    }
    if (anyEdge) PN.using = true;

    if (edges[9]){
      if (PN.onStart) PN.onStart();
      else if (act) key('Escape');
    }
    /* a menu just opened over the game: start with its first button lit */
    if (act && !wasAct && PN.using) setTimeout(PN.reset, 60);
    wasAct = act;
    if (!act){ held = null; return; }

    /* one diagonal at a time: whichever axis is pressed is the move */
    var dir = dirY ? 'y' + dirY : dirX ? 'x' + dirX : null;
    if (dir){
      if (dir !== held){ held = dir; repeatAt = now + 380; PN.using = true; go(dir); }
      else if (now >= repeatAt){ repeatAt = now + 110; go(dir); }
    } else held = null;

    if (edges[0]) press();
    if (edges[1]) back();

    if (scroll){
      var tgt = cur && scrollParent(cur);
      (tgt || document.scrollingElement || document.documentElement).scrollBy(0, scroll * 16);
    }
  }

  function go(dir){
    if (dir === 'x-1') move(-1, 0); else if (dir === 'x1') move(1, 0);
    else if (dir === 'y-1') move(0, -1); else move(0, 1);
  }

  /* moving the mouse hands the page back to the mouse */
  var mx = -1, my = -1;
  addEventListener('mousemove', function(ev){
    if (Math.abs(ev.clientX - mx) + Math.abs(ev.clientY - my) < 6) return;
    mx = ev.clientX; my = ev.clientY;
    PN.using = false;
    if (cur){ cur.classList.remove('pn-focus'); cur = null; }
  }, { passive: true });

  addEventListener('gamepadconnected', function(){ greeted = false; });
  if (navigator.getGamepads) requestAnimationFrame(tick);

  /* for games: focus the best control in whatever menu just opened */
  PN.reset = function(){
    if (cur){ cur.classList.remove('pn-focus'); cur = null; }
    if (!PN.using) return;
    var list = candidates();
    if (list.length) mark(first(list));
  };
  PN.say = say;
  PN.candidates = candidates;   // what a press can reach right now (for debugging)
})();
