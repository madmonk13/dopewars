// A small Palm OS 3.5 emulation layer: just the Form/Control/Field/Window/Font/Menu/Event
// APIs that DopeWars calls, drawn into a 160x160 canvas. Function names follow the Palm OS
// SDK so game.js can read like the original C. Modal calls (FrmAlert, FrmDoDialog...) return
// Promises and run nested event loops, the same way the real ones block.
(function () {
  "use strict";

  const SCREEN = 160;
  const ev = {
    nilEvent: 0, penDownEvent: 1, penUpEvent: 2, penMoveEvent: 3, keyDownEvent: 4,
    ctlEnterEvent: 7, ctlSelectEvent: 9, ctlExitEvent: 10, frmLoadEvent: 23,
    frmOpenEvent: 24, frmCloseEvent: 26, menuEvent: 21, appStopEvent: 22,
  };

  // ------------------------------------------------------------------ screen + drawing
  let canvas, ctx;
  let curFont = 0;
  let winOrigin = { x: 0, y: 0 };
  const images = {};

  function px(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(winOrigin.x + x, winOrigin.y + y, w, h);
  }
  const ink = (x, y, w = 1, h = 1) => px(x, y, w, h, "#000");
  const paper = (x, y, w = 1, h = 1) => px(x, y, w, h, "#fff");

  function font(id) { return PalmFonts[id] || PalmFonts[0]; }

  function glyphOf(f, ch) {
    let g = f.glyphs[ch];
    let top = g ? g.top : 0;
    if (!g && f.fallback) {
      g = f.fallback[ch];
      top = (f.fallbackTop || 0) + (g ? g.top : 0);
    }
    if (!g) g = font(0).glyphs["?"], top = g.top;
    return { g, top };
  }

  function FntCharsWidth(s, fontId = curFont) {
    const f = font(fontId);
    let w = 0;
    for (const ch of s) w += glyphOf(f, ch).g.width + 1;
    return w;
  }
  const FntLineHeight = () => font(curFont).height;

  // Draws text with background like WinDrawChars (winPaint mode).
  function drawText(s, x, y, fontId = curFont, inverted = false) {
    const f = font(fontId);
    const fg = inverted ? "#fff" : "#000";
    const bg = inverted ? "#000" : "#fff";
    let cx = x;
    for (const ch of s) {
      const { g, top } = glyphOf(f, ch);
      px(cx, y, g.width + 1, f.height, bg);
      g.rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) if (row[c] === "#") px(cx + c, y + top + r, 1, 1, fg);
      });
      cx += g.width + 1;
    }
    return cx - x;
  }

  // Views other than the canvas (the "Modern" style) read what the game drew: every WinDrawChars
  // is remembered on the active form, and erasing a rectangle forgets the text inside it.
  let version = 0;
  const touch = () => { version++; };
  function WinDrawChars(s, len, x, y) {
    const text = String(s).slice(0, len);
    drawText(text, x, y);
    if (activeForm) {
      const list = activeForm.texts || (activeForm.texts = []);
      for (let i = list.length - 1; i >= 0; i--) if (list[i].x === x && list[i].y === y) list.splice(i, 1);
      list.push({ x, y, text, font: curFont });
      touch();
    }
  }
  function WinEraseRectangle(r) {
    paper(r.x, r.y, r.w, r.h);
    if (activeForm && activeForm.texts) {
      activeForm.texts = activeForm.texts.filter((t) => !(t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h));
      touch();
    }
  }
  function WinSetClip(r) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(winOrigin.x + r.x, winOrigin.y + r.y, r.w, r.h);
    ctx.clip();
  }
  function WinResetClip() { ctx.restore(); }
  function FntSetFont(id) { const old = curFont; curFont = id; return old; }

  function grayRect(x, y, w, h) {
    for (let i = x; i < x + w; i++) {
      if ((i + y) % 2 === 0) ink(i, y);
      if ((i + y + h - 1) % 2 === 0) ink(i, y + h - 1);
    }
    for (let j = y; j < y + h; j++) {
      if ((x + j) % 2 === 0) ink(x, j);
      if ((x + w - 1 + j) % 2 === 0) ink(x + w - 1, j);
    }
  }

  // 1px round frame drawn just outside (x,y,w,h), like Palm's roundFrame for buttons.
  function roundFrame(x, y, w, h, fill) {
    const fx = x - 1, fy = y - 1, fw = w + 2, fh = h + 2;
    if (fill) {
      ink(fx + 2, fy + 1, fw - 4, fh - 2);
      ink(fx + 1, fy + 2, fw - 2, fh - 4);
    }
    ink(fx + 2, fy, fw - 4, 1);
    ink(fx + 2, fy + fh - 1, fw - 4, 1);
    ink(fx, fy + 2, 1, fh - 4);
    ink(fx + fw - 1, fy + 2, 1, fh - 4);
    ink(fx + 1, fy + 1); ink(fx + fw - 2, fy + 1);
    ink(fx + 1, fy + fh - 2); ink(fx + fw - 2, fy + fh - 2);
  }

  // dialogFrame: 2px wide, small rounded corners, outside the window bounds (absolute coords).
  function dialogFrame(b) {
    const o = winOrigin;
    winOrigin = { x: 0, y: 0 };
    const x = b.x - 2, y = b.y - 2, w = b.w + 4, h = b.h + 4;
    ink(x + 1, y, w - 2, 2); ink(x + 1, y + h - 2, w - 2, 2);
    ink(x, y + 1, 2, h - 2); ink(x + w - 2, y + 1, 2, h - 2);
    winOrigin = o;
  }

  function drawBitmap(id, x, y) {
    const img = images[id];
    if (img) ctx.drawImage(img, winOrigin.x + x, winOrigin.y + y);
  }

  // ------------------------------------------------------------------ word wrap
  function wordWrap(text, width, fontId) {
    const lines = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      const words = para.split(/(?<= )/); // keep trailing spaces like FntWordWrap
      for (const word of words) {
        if (FntCharsWidth((line + word).trimEnd(), fontId) <= width) { line += word; continue; }
        if (line) { lines.push(line.trimEnd()); line = ""; }
        let w = word;
        while (FntCharsWidth(w.trimEnd(), fontId) > width) {
          let n = w.length;
          while (n > 1 && FntCharsWidth(w.slice(0, n), fontId) > width) n--;
          lines.push(w.slice(0, n));
          w = w.slice(n);
        }
        line = w;
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }

  // ------------------------------------------------------------------ forms
  let formUid = 0;
  class Form {
    constructor(id, def) {
      this.id = id;
      this.def = def;
      this.bounds = { ...def.bounds };
      this.modal = def.modal;
      this.title = null;
      this.objects = def.objects.map((o) => ({ ...o, visible: true }));
      for (const o of this.objects) {
        if (o.kind === "title") this.title = o.text;
        if (o.kind === "field") Object.assign(o, { text: "", numeric: false });
        if (o.kind === "control") o.usable = !!(o.attr & 0x8000), o.enabled = !!(o.attr & 0x4000);
      }
      this.menuId = def.menuRscId;
      this.focus = -1;
      this.handler = null;
      this.saved = null;
      this.drawn = false;
      this.uid = ++formUid;
      this.texts = [];
    }
    abs(x, y) { return { x: this.bounds.x + x, y: this.bounds.y + y }; }
  }

  let forms = {};          // loaded forms by id
  let activeForm = null;
  const formStack = [];    // popup / dialog stack (forms underneath)

  function withWindow(frm, fn) {
    const o = winOrigin;
    winOrigin = { x: frm.bounds.x, y: frm.bounds.y };
    try { return fn(); } finally { winOrigin = o; }
  }

  function FrmInitForm(id) {
    const def = PRC.forms[id];
    if (!def) throw new Error("no form " + id);
    const frm = new Form(id, def);
    if (pendingPopup === id) frm.popup = true, pendingPopup = 0;
    forms[id] = frm;
    return frm;
  }
  const FrmGetFormPtr = (id) => forms[id] || null;
  const FrmGetActiveForm = () => activeForm;
  const FrmGetActiveFormID = () => (activeForm ? activeForm.id : 0);
  function setActive(frm) {
    activeForm = frm;
    touch();
    winOrigin = frm ? { x: frm.bounds.x, y: frm.bounds.y } : { x: 0, y: 0 };
  }
  function FrmSetActiveForm(frm) { setActive(frm); }
  const FrmGetObjectIndex = (frm, id) => frm.objects.findIndex((o) => o.id === id);
  const FrmGetObjectPtr = (frm, idx) => frm.objects[idx];
  const FrmGetTitle = (frm) => frm.title;
  function FrmSetEventHandler(frm, fn) { frm.handler = fn; }

  function saveBehind(frm) {
    const b = frm.bounds;
    const x = Math.max(0, b.x - 2), y = Math.max(0, b.y - 2);
    const w = Math.min(SCREEN, b.x + b.w + 2) - x, h = Math.min(SCREEN, b.y + b.h + 2) - y;
    frm.saved = { x, y, data: ctx.getImageData(x, y, w, h) };
  }

  function drawTitle(frm) {
    if (frm.title == null) return;
    withWindow(frm, () => {
      const w = frm.bounds.w;
      if (frm.modal) {
        ink(0, 0, w, 11);
        const tw = FntCharsWidth(frm.title, 1);
        drawText(frm.title, Math.floor((w - tw) / 2), 0, 1, true);
      } else {
        const tw = FntCharsWidth(frm.title, 1) + 4;
        ink(0, 0, tw, 11);
        drawText(frm.title, 2, 0, 1, true);
        ink(0, 11, w, 2);
      }
    });
  }

  function drawControl(frm, o, pressed = false) {
    if (!o.visible || !o.usable) return;
    withWindow(frm, () => {
      const b = o.bounds;
      const label = o.text || "";
      const tw = FntCharsWidth(label, o.font);
      const tx = b.x + Math.floor((b.w - tw) / 2);
      const ty = b.y + Math.floor((b.h - font(o.font).height) / 2);
      if (o.style === "arrow") {
        if (o.paint) o.paint(pressed);
      } else if (o.style === "button") {
        paper(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
        roundFrame(b.x, b.y, b.w, b.h, pressed);
        drawText(label, tx, ty, o.font, pressed);
      } else {
        // selector trigger: gray frame, label centred
        if (pressed) ink(b.x, b.y, b.w, b.h); else paper(b.x, b.y, b.w, b.h);
        grayRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
        drawText(label, tx, ty, o.font, pressed);
      }
    });
  }

  function drawField(frm, o) {
    if (!o.visible) return;
    withWindow(frm, () => {
      const b = o.bounds;
      const lh = font(o.font).height;
      const lines = Math.max(1, Math.floor(b.h / lh));
      paper(b.x, b.y, b.w, lines * lh); // only the text lines, not the whole bounds
      for (let l = 0; l < lines; l++) {
        const uy = b.y + (l + 1) * lh - 1;
        for (let i = b.x; i < b.x + b.w; i += 2) ink(i, uy);
      }
      drawText(o.text, b.x, b.y, o.font);
      const idx = frm.objects.indexOf(o);
      if (frm.focus === idx && caretOn) {
        const cx = Math.min(b.x + FntCharsWidth(o.text, o.font), b.x + b.w - 1);
        ink(cx, b.y, 1, lh - 1);
      }
    });
  }

  function drawObject(frm, o) {
    if (!o.visible) return;
    switch (o.kind) {
      case "control": drawControl(frm, o); break;
      case "label": withWindow(frm, () => drawText(o.text, o.x, o.y, o.font)); break;
      case "bitmap": withWindow(frm, () => drawBitmap(o.rscId, o.x, o.y)); break;
      case "field": drawField(frm, o); break;
    }
  }

  function FrmDrawForm(frm) {
    touch();
    if (frm.popup && !frm.saved) saveBehind(frm);
    const b = frm.bounds;
    withWindow(frm, () => paper(0, 0, b.w, b.h));
    if (frm.def.frame) dialogFrame(b);
    drawTitle(frm);
    for (const o of frm.objects) if (o.kind !== "title") drawObject(frm, o);
    frm.drawn = true;
  }

  function FrmEraseForm(frm) {
    touch();
    if (frm.saved) {
      ctx.putImageData(frm.saved.data, frm.saved.x, frm.saved.y);
      frm.saved = null;
    } else if (frm.drawn) {
      const b = frm.bounds;
      const o = winOrigin; winOrigin = { x: 0, y: 0 };
      paper(Math.max(0, b.x - 2), Math.max(0, b.y - 2), b.w + 4, b.h + 4);
      winOrigin = o;
    }
    frm.drawn = false;
  }

  function FrmDeleteForm(frm) {
    if (frm.drawn) FrmEraseForm(frm);
    if (forms[frm.id] === frm) delete forms[frm.id];
    if (activeForm === frm) setActive(formStack.length ? formStack[formStack.length - 1] : null);
  }

  function FrmSetTitle(frm, s) {
    touch();
    frm.title = s;
    if (frm.drawn) drawTitle(frm);
  }
  function FrmShowObject(frm, idx) { touch(); frm.objects[idx].visible = true; if (frm.drawn) drawObject(frm, frm.objects[idx]); }
  function FrmHideObject(frm, idx) {
    touch();
    const o = frm.objects[idx];
    if (o.visible && frm.drawn && o.bounds) withWindow(frm, () => paper(o.bounds.x - 1, o.bounds.y - 1, o.bounds.w + 2, o.bounds.h + 2));
    o.visible = false;
  }
  function FrmSetFocus(frm, idx) { frm.focus = idx; if (frm.drawn) drawField(frm, frm.objects[idx]); }

  // Control / field helpers (strings stand in for the char* the C code pokes at).
  const CtlGetLabel = (o) => o.text;
  function CtlSetLabelText(o, s) { o.text = s; touch(); }
  const FldGetTextPtr = (o) => (o.text.length ? o.text : null);
  function FldSetText(frm, o, s, redraw) { o.text = s; if (redraw && frm.drawn) drawField(frm, o); }
  function FldSetNumeric(o) { o.numeric = true; }
  function FldDelete(o) { o.text = ""; }

  // ------------------------------------------------------------------ event queue
  const queue = [];
  let waiter = null;
  function EvtAddEvent(e) {
    queue.push(e);
    if (waiter) { const w = waiter; waiter = null; w(); }
  }
  async function EvtGetEvent() {
    while (!queue.length) await new Promise((r) => (waiter = r));
    const e = queue.shift();
    if (e.eType === ev.frmLoadEvent && e.popup) {
      formStack.push(activeForm);
      pendingPopup = e.formID;
    }
    return e;
  }
  let pendingPopup = 0;

  function FrmGotoForm(id) {
    if (activeForm) EvtAddEvent({ eType: ev.frmCloseEvent, formID: activeForm.id });
    EvtAddEvent({ eType: ev.frmLoadEvent, formID: id });
    EvtAddEvent({ eType: ev.frmOpenEvent, formID: id });
  }
  function FrmPopupForm(id) {
    EvtAddEvent({ eType: ev.frmLoadEvent, formID: id, popup: true });
    EvtAddEvent({ eType: ev.frmOpenEvent, formID: id });
  }
  function FrmReturnToForm(id) {
    const frm = activeForm;
    FrmEraseForm(frm);
    delete forms[frm.id];
    formStack.pop();
    setActive(FrmGetFormPtr(id));
  }

  // Default handling: control tracking produces ctlSelectEvent, closing deletes the form.
  async function FrmHandleEvent(frm, e) {
    if (e.eType === ev.frmCloseEvent) {
      FrmDeleteForm(frm);
      formStack.length = 0;
      const o = winOrigin; winOrigin = { x: 0, y: 0 };
      paper(0, 0, SCREEN, SCREEN);
      winOrigin = o;
      return true;
    }
    if (e.eType === ev.frmOpenEvent) { FrmDrawForm(frm); return true; }
    if (e.eType === ev.keyDownEvent && frm.focus >= 0) return fieldKey(frm, e);
    return false;
  }

  async function FrmDispatchEvent(e) {
    const frm = activeForm;
    if (!frm) return false;
    if (frm.handler && (await frm.handler(e))) return true;
    return FrmHandleEvent(frm, e);
  }

  function fieldKey(frm, e) {
    const o = frm.objects[frm.focus];
    if (!o || o.kind !== "field") return false;
    if (e.chr === 8) o.text = o.text.slice(0, -1);
    else if (e.chr >= 32) {
      const ch = String.fromCharCode(e.chr);
      if (o.numeric && !/[0-9]/.test(ch)) return true;
      if (o.text.length >= o.maxChars) return true;
      o.text += ch;
    } else return false;
    drawField(frm, o);
    return true;
  }

  // ------------------------------------------------------------------ pen tracking
  function hitControl(frm, x, y) {
    if (!frm) return null;
    const lx = x - frm.bounds.x, ly = y - frm.bounds.y;
    for (let i = frm.objects.length - 1; i >= 0; i--) {
      const o = frm.objects[i];
      if (!o.bounds || !o.visible) continue;
      const b = o.bounds;
      if (lx >= b.x && lx < b.x + b.w && ly >= b.y && ly < b.y + b.h) return { o, i };
    }
    return null;
  }

  let tracking = null;
  function penDown(x, y) {
    if (menuState) return menuPen(x, y, "down");
    const frm = activeForm;
    if (!frm) { if (PalmOS.onIdleTap) PalmOS.onIdleTap(x, y); return; }
    if (frm.menuId && frm.title != null && y < frm.bounds.y + 11 && x < frm.bounds.x + frm.bounds.w) {
      openMenu();
      return;
    }
    const hit = hitControl(frm, x, y);
    if (!hit) return;
    if (hit.o.kind === "control" && hit.o.enabled && hit.o.usable) {
      tracking = { frm, o: hit.o, inside: true };
      drawControl(frm, hit.o, true);
    } else if (hit.o.kind === "field") {
      frm.focus = hit.i;
      drawField(frm, hit.o);
      PalmOS.onFieldTap && PalmOS.onFieldTap(hit.o);
    }
  }
  function penMove(x, y) {
    if (!tracking) return;
    const h = hitControl(tracking.frm, x, y);
    const inside = !!h && h.o === tracking.o;
    if (inside !== tracking.inside) { tracking.inside = inside; drawControl(tracking.frm, tracking.o, inside); }
  }
  function penUp(x, y) {
    if (menuState) return menuPen(x, y, "up");
    if (!tracking) return;
    const t = tracking;
    tracking = null;
    if (!t.frm.drawn) return;
    drawControl(t.frm, t.o, false);
    if (t.inside) EvtAddEvent({ eType: ev.ctlSelectEvent, controlID: t.o.id });
  }

  // ------------------------------------------------------------------ modal dialogs
  async function modalLoop(frm, onEvent) {
    const prev = activeForm;
    formStack.push(prev);
    setActive(frm);
    try {
      for (;;) {
        const e = await EvtGetEvent();
        if (e.eType === ev.appStopEvent) { queue.unshift(e); return 0; }
        if (e.eType === ev.ctlSelectEvent) {
          const r = await onEvent(e);
          if (r !== undefined) return r;
        } else if (e.eType === ev.keyDownEvent) {
          fieldKey(frm, e);
        }
      }
    } finally {
      formStack.pop();
      setActive(prev);
    }
  }

  async function FrmDoDialog(frm) {
    frm.popup = true;
    FrmDrawForm(frm);
    return modalLoop(frm, (e) => {
      const o = frm.objects.find((x) => x.id === e.controlID);
      if (o && o.style === "button") return e.controlID;
      return undefined;
    });
  }

  function drawAlertIcon(type, x, y) {
    // filled circle / triangle / octagon with a white glyph, 21x21
    const g = { information: "i", confirmation: "?", warning: "!", error: "!" }[type] || "i";
    for (let r = 0; r < 21; r++) {
      for (let c = 0; c < 21; c++) {
        const dx = c - 10, dy = r - 10;
        let inside;
        if (type === "warning") inside = r >= 1 && Math.abs(dx) <= (r - 1) / 2 + 0.5;
        else if (type === "error") inside = Math.abs(dx) <= 10 && Math.abs(dy) <= 10 && Math.abs(dx) + Math.abs(dy) <= 14;
        else inside = dx * dx + dy * dy <= 110;
        if (inside) ink(x + c, y + r);
      }
    }
    const f = font(1);
    const { g: gl } = glyphOf(f, g);
    const gx = x + 11 - Math.ceil(gl.width / 2), gy = y + (type === "warning" ? 8 : 6);
    gl.rows.forEach((row, r) => { for (let c = 0; c < row.length; c++) if (row[c] === "#") paper(gx + c, gy + r); });
  }

  function buildAlert(alertId, s1 = "", s2 = "", s3 = "") {
    const a = PRC.alerts[alertId];
    const msg = a.message.replace(/\^1/g, s1).replace(/\^2/g, s2).replace(/\^3/g, s3);
    const textX = 34, textW = 156 - textX - 6;
    const lines = wordWrap(msg, textW, 0);
    const textBottom = 16 + lines.length * 11;
    const btnY = Math.max(textBottom, 16 + 22) + 4;
    const h = btnY + 12 + 5;
    const def = { bounds: { x: 2, y: 158 - h, w: 156, h }, modal: true, frame: 0x302, menuRscId: 0, objects: [] };
    def.objects.push({ kind: "title", text: a.title });
    let bx = 6;
    a.buttons.forEach((label, i) => {
      const w = Math.max(FntCharsWidth(label, 0) + 8, 36);
      def.objects.push({ kind: "control", id: i, bounds: { x: bx, y: btnY, w, h: 12 }, attr: 0xc900, style: "button", font: 0, text: label });
      bx += w + 6;
    });
    const frm = new Form(alertId, def);
    frm.popup = true;
    frm.alert = { type: a.type, lines, textX, title: a.title, message: msg, buttons: a.buttons.slice() };
    return frm;
  }

  async function FrmCustomAlert(alertId, s1, s2, s3) {
    const frm = buildAlert(alertId, s1, s2, s3);
    FrmDrawForm(frm);
    withWindow(frm, () => {
      drawAlertIcon(frm.alert.type, 6, 16);
      frm.alert.lines.forEach((l, i) => drawText(l, frm.alert.textX, 15 + i * 11, 0));
    });
    const r = await modalLoop(frm, (e) => e.controlID);
    FrmEraseForm(frm);
    return r;
  }
  const FrmAlert = (id) => FrmCustomAlert(id);

  // Tips dialog for FrmHelp(tSTR id): text, Done button, scroll arrows.
  let scrollHook = null;
  async function FrmHelp(strId) {
    const def = { bounds: { x: 2, y: 2, w: 156, h: 156 }, modal: true, frame: 0x302, menuRscId: 0,
      objects: [{ kind: "title", text: "Tips" },
        { kind: "control", id: 1, bounds: { x: 5, y: 140, w: 36, h: 12 }, attr: 0xc900, style: "button", font: 0, text: "Done" },
        { kind: "control", id: 2, bounds: { x: 132, y: 141, w: 9, h: 10 }, attr: 0xc900, style: "arrow", font: 0, text: "" },
        { kind: "control", id: 3, bounds: { x: 142, y: 141, w: 9, h: 10 }, attr: 0xc900, style: "arrow", font: 0, text: "" }] };
    const frm = new Form(0, def);
    frm.popup = true;
    frm.help = PRC.strings[strId] || "";
    const lines = wordWrap(frm.help, 146, 0);
    const per = 11;
    let top = 0;
    const arrow = (o, up, enabled, pressed) => withWindow(frm, () => {
      const b = o.bounds;
      paper(b.x, b.y, b.w, b.h);
      for (let r = 0; r < 5; r++) {
        const half = up ? r : 4 - r;
        for (let c = -half; c <= half; c++) {
          if (enabled || (c + half) % 2 === 0) (pressed ? paper : ink)(b.x + 4 + c, b.y + 2 + r);
        }
      }
    });
    const [upObj, downObj] = [frm.objects[2], frm.objects[3]];
    upObj.paint = (p) => arrow(upObj, true, top > 0, p && top > 0);
    downObj.paint = (p) => arrow(downObj, false, top + per < lines.length, p && top + per < lines.length);
    const paint = () => {
      withWindow(frm, () => {
        paper(3, 14, 150, per * 11);
        lines.slice(top, top + per).forEach((l, i) => drawText(l, 4, 14 + i * 11, 0));
      });
      upObj.paint(false);
      downObj.paint(false);
    };
    scrollHook = (d) => { top = Math.max(0, Math.min(top + d * per, Math.max(0, lines.length - per))); paint(); };
    FrmDrawForm(frm);
    paint();
    await modalLoop(frm, (e) => {
      if (e.controlID === 1) return 1;
      scrollHook(e.controlID === 2 ? -1 : 1);
      return undefined;
    });
    scrollHook = null;
    FrmEraseForm(frm);
  }

  // ------------------------------------------------------------------ menus
  let menuState = null;
  function openMenu() {
    const frm = activeForm;
    if (!frm || !frm.menuId || menuState || formStack.length) return false;
    const menus = PRC.menus[frm.menuId];
    const o = winOrigin; winOrigin = { x: 0, y: 0 };
    const saved = ctx.getImageData(0, 0, SCREEN, SCREEN);
    menuState = { menus, saved, open: 0, hover: -1 };
    paintMenu();
    winOrigin = o;
    return true;
  }
  function closeMenu() {
    ctx.putImageData(menuState.saved, 0, 0);
    menuState = null;
  }
  function menuLayout() {
    const titles = [];
    let x = 2;
    for (const m of menuState.menus) {
      const w = FntCharsWidth(m.title, 1) + 8;
      titles.push({ x, w });
      x += w;
    }
    const m = menuState.menus[menuState.open];
    const items = m.items;
    let iw = 0;
    for (const it of items) iw = Math.max(iw, FntCharsWidth(it.text.trimEnd(), 0) + (it.shortcut ? 22 : 8));
    let mx = titles[menuState.open].x;
    if (mx + iw + 4 > SCREEN) mx = SCREEN - iw - 4;
    const rows = items.map((it) => (it.text === "-" ? 5 : 11));
    return { titles, barW: x + 2, mx, iw, rows, items };
  }
  function paintMenu() {
    const o = winOrigin; winOrigin = { x: 0, y: 0 };
    ctx.putImageData(menuState.saved, 0, 0);
    const L = menuLayout();
    paper(0, 0, L.barW + 1, 14);
    ink(0, 13, L.barW + 1, 1); ink(L.barW, 0, 1, 14);
    menuState.menus.forEach((m, i) => {
      const t = L.titles[i];
      if (i === menuState.open) ink(t.x, 1, t.w, 11);
      drawText(m.title, t.x + 4, 1, 1, i === menuState.open);
    });
    const h = L.rows.reduce((a, b) => a + b, 0) + 4;
    const x = L.mx, y = 14, w = L.iw + 4;
    paper(x, y, w, h);
    ink(x, y, 1, h); ink(x + w - 1, y, 1, h); ink(x, y + h - 1, w, 1);
    ink(x + 2, y + h, w - 1, 1); ink(x + w, y + 2, 1, h - 1); // shadow
    let iy = y + 2;
    L.items.forEach((it, i) => {
      if (it.text === "-") {
        for (let c = x + 2; c < x + w - 2; c += 2) ink(c, iy + 2);
      } else {
        const sel = i === menuState.hover;
        if (sel) ink(x + 1, iy, w - 2, 11);
        drawText(it.text.trimEnd(), x + 4, iy, 0, sel);
        if (it.shortcut) {
          const sx = x + w - 14;
          // Palm's command-stroke glyph: a short diagonal, then the letter
          for (let k = 0; k < 4; k++) (sel ? paper : ink)(sx + k, iy + 7 - k);
          drawText(it.shortcut, sx + 5, iy, 0, sel);
        }
      }
      iy += L.rows[i];
    });
    menuState.box = { x, y: y + 2, w, rows: L.rows };
    menuState.L = L;
    winOrigin = o;
  }
  function menuPen(x, y, phase) {
    const L = menuState.L;
    if (y < 14) {
      const i = L.titles.findIndex((t) => x >= t.x && x < t.x + t.w);
      if (i >= 0 && phase === "down") { menuState.open = i; menuState.hover = -1; paintMenu(); }
      else if (i < 0 && phase === "down") closeMenu();
      return;
    }
    const b = menuState.box;
    if (x >= b.x && x < b.x + b.w) {
      let iy = b.y;
      for (let i = 0; i < b.rows.length; i++) {
        if (y >= iy && y < iy + b.rows[i]) {
          const it = L.items[i];
          if (it.text === "-") return;
          if (phase === "down") { menuState.hover = i; paintMenu(); }
          else if (menuState.hover === i) { closeMenu(); EvtAddEvent({ eType: ev.menuEvent, itemID: it.id }); }
          return;
        }
        iy += b.rows[i];
      }
    }
    if (phase === "down") closeMenu();
  }
  function menuShortcut(letter) {
    const frm = activeForm;
    if (!frm || !frm.menuId || formStack.length) return false;
    for (const m of PRC.menus[frm.menuId]) {
      for (const it of m.items) {
        if (it.shortcut && it.shortcut.toUpperCase() === letter.toUpperCase()) {
          EvtAddEvent({ eType: ev.menuEvent, itemID: it.id });
          return true;
        }
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ caret blink
  let caretOn = true;
  function blink() {
    caretOn = !caretOn;
    const frm = activeForm;
    if (frm && frm.drawn && frm.focus >= 0 && !menuState) {
      const o = frm.objects[frm.focus];
      if (o && o.kind === "field") drawField(frm, o);
    }
  }

  // ------------------------------------------------------------------ input wiring
  function toScreen(evt) {
    const r = canvas.getBoundingClientRect();
    return { x: Math.floor(((evt.clientX - r.left) / r.width) * SCREEN), y: Math.floor(((evt.clientY - r.top) / r.height) * SCREEN) };
  }

  function init(cv) {
    canvas = cv;
    ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    paper(0, 0, SCREEN, SCREEN);
    canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); const p = toScreen(e); penDown(p.x, p.y); });
    canvas.addEventListener("pointermove", (e) => { const p = toScreen(e); penMove(p.x, p.y); });
    canvas.addEventListener("pointerup", (e) => { const p = toScreen(e); penUp(p.x, p.y); });
    canvas.addEventListener("wheel", (e) => { if (scrollHook) { e.preventDefault(); scrollHook(e.deltaY > 0 ? 1 : -1); } }, { passive: false });
    setInterval(blink, 500);
  }

  function keyDown(chr) {
    if (menuState) { closeMenu(); return; }
    EvtAddEvent({ eType: ev.keyDownEvent, chr });
  }

  async function loadImages() {
    const jobs = [];
    for (const [name, depths] of Object.entries(PRC.bitmaps)) {
      const id = Number(name.split("_")[1]);
      const pick = depths["8"] || depths["1"];
      const img = new Image();
      img.src = pick.src;
      images[name.startsWith("tAIB") ? "icon" + id : id] = img;
      jobs.push(img.decode().catch(() => {}));
    }
    await Promise.all(jobs);
  }

  function clearScreen() {
    const o = winOrigin; winOrigin = { x: 0, y: 0 };
    paper(0, 0, SCREEN, SCREEN);
    winOrigin = o;
    forms = {};
    setActive(null);
    formStack.length = 0;
    queue.length = 0;
    if (menuState) menuState = null;
  }

  // ------------------------------------------------------------------ SysRandom / Str*
  let randomSeed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
  function SysRandom(newSeed) {
    if (newSeed) randomSeed = newSeed >>> 0;
    randomSeed = (Math.imul(randomSeed, 0x015a4e35) + 1) >>> 0;
    return (randomSeed >>> 16) & 0x7fff;
  }

  window.PalmOS = {
    ev, init, loadImages, clearScreen, keyDown, openMenu, menuShortcut, images,
    get scrolling() { return !!scrollHook; }, scroll: (d) => scrollHook && scrollHook(d),
    FntSetFont, FntCharsWidth, FntLineHeight, WinDrawChars, WinEraseRectangle, WinSetClip, WinResetClip,
    drawText, drawBitmap, ink, paper, withWindow,
    FrmInitForm, FrmDeleteForm, FrmDrawForm, FrmEraseForm, FrmGotoForm, FrmPopupForm, FrmReturnToForm,
    FrmGetFormPtr, FrmGetActiveForm, FrmGetActiveFormID, FrmSetActiveForm, FrmGetObjectIndex, FrmGetObjectPtr,
    FrmGetTitle, FrmSetTitle, FrmShowObject, FrmHideObject, FrmSetFocus, FrmSetEventHandler, FrmDispatchEvent,
    FrmHandleEvent, FrmDoDialog, FrmAlert, FrmCustomAlert, FrmHelp,
    CtlGetLabel, CtlSetLabelText, FldGetTextPtr, FldSetText, FldSetNumeric, FldDelete, drawField,
    EvtGetEvent, EvtAddEvent, SysRandom,
    onFieldTap: null,
    onIdleTap: null,
    // read-only view of the UI state for alternative renderers
    get version() { return version; },
    view: () => ({ active: activeForm, stack: formStack.slice(), menuOpen: !!menuState }),
    closeMenu: () => { if (menuState) closeMenu(); },
    get activeFieldNumeric() {
      const f = activeForm;
      const o = f && f.focus >= 0 ? f.objects[f.focus] : null;
      return !!(o && o.numeric);
    },
  };
})();
