// "Modern" style: an HTML view of the same game. It only reads state (PalmOS.view(), DopeWars.state,
// the text the game drew) and sends the same events the Palm screen would (control taps, menu
// choices, field text), so the game logic in game.js runs exactly as in the Classic style.
(function () {
  "use strict";
  const P = PalmOS;
  const g = DopeWars.state;
  const root = document.getElementById("modern");
  let enabled = false;
  let menuOpen = false;
  let lastSig = "";

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const drugNames = PRC.forms[1003].objects.filter((o) => o.kind === "control" && o.id >= 2000 && o.id <= 2007).map((o) => o.text);
  const send = (controlID) => P.EvtAddEvent({ eType: P.ev.ctlSelectEvent, controlID });
  const CREDITS = `<dl class="credits">
      <dt>Original concept</dt><dd>“Drug Wars” by John E. Dell</dd>
      <dt>Palm version</dt><dd>Created by Matthew Lee<br>Updated by Michael Hallett (2.4.6)</dd>
      <dt>Web port</dt><dd>Jeff Ulicny</dd>
    </dl>`;
  const imgSrc = (id) => { const b = PRC.bitmaps["Tbmp_" + id]; return b ? (b["8"] || b["1"]).src : ""; };

  // ---------------------------------------------------------------- helpers over captured text
  const texts = (frm) => (frm && frm.texts ? frm.texts.slice() : []);
  const textAt = (frm, x, y) => (texts(frm).find((t) => t.x === x && t.y === y) || {}).text || "";
  function rows(frm, minY) {
    const byY = new Map();
    for (const t of texts(frm)) {
      if (t.y < minY) continue;
      if (!byY.has(t.y)) byY.set(t.y, []);
      byY.get(t.y).push(t);
    }
    return [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, items]) => items.sort((a, b) => a.x - b.x));
  }
  function scoreRows(frm, minY) {
    return rows(frm, minY)
      .filter((r) => r.some((t) => t.x === 5))
      .map((r) => ({ name: (r.find((t) => t.x === 5) || {}).text || "", value: (r.find((t) => t.x === 100) || {}).text || "", bold: r[0].font === 1 }));
  }
  const labels = (frm) => frm.objects.filter((o) => o.kind === "label" && o.text.trim()).map((o) => o.text.trim());
  const buttons = (frm) => frm.objects.filter((o) => o.kind === "control" && o.style === "button" && o.usable && o.visible);
  const isPrimary = (label) => /^(ok|yes|start game|start new game|fight)$/i.test(label.trim());
  const niceLabel = (label) => (label === '"000"' ? "+000" : label);
  function btnRow(frm) {
    return `<div class="actions">${buttons(frm).map((b) => `<button class="btn ${isPrimary(b.text) ? "primary" : ""}" data-ctl="${b.id}">${esc(niceLabel(b.text))}</button>`).join("")}</div>`;
  }

  // ---------------------------------------------------------------- base screens
  function header(title, right = "", withMenu = false, eyebrow = "DopeWars") {
    return `<header class="top">
      <div class="title"><span class="eyebrow">${eyebrow}</span><h1>${esc(title)}</h1></div>
      <div class="top-right">${right}${withMenu ? `<button class="icon-btn" data-act="menu" aria-label="Menu"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>` : ""}</div>
    </header>`;
  }

  function mainScreen(frm, interactive) {
    const money = (v) => DopeWars.formatMoney(v);
    const used = g.coatUsed, cap = g.coat;
    const weapon = ["None", "Gun", "Shotgun"][g.gun] || "None";
    const cheat = texts(frm).some((t) => t.text === "Cheat");
    const market = drugNames.map((name, i) => {
      const price = g.price[i];
      const have = g.qty[i];
      return `<li class="drug ${price > 0 ? "" : "unavailable"}">
        <div class="drug-info">
          <span class="drug-name">${esc(name)}</span>
          <span class="drug-meta">${have > 0 ? `You have <b>${have}</b>` : "None held"}</span>
        </div>
        <span class="drug-price">${price > 0 ? "$" + price : "Not sold"}</span>
        <div class="drug-actions">
          <button class="pill" data-ctl="${2010 + i}" ${interactive ? "" : "disabled"}>Sell</button>
          <button class="pill solid" data-ctl="${2020 + i}" ${interactive ? "" : "disabled"}>Buy</button>
        </div>
      </li>`;
    }).join("");
    const eyebrow = `Weapon: ${weapon}${cheat ? ' · <span class="warn-text">Cheat</span>' : ""}`;
    return `${header(g.locName || "", `<span class="chip">${g.days} ${g.days === 1 ? "day" : "days"} left</span>`, interactive, eyebrow)}
      <section class="stats">
        ${[["Cash", g.cash], ["Debt", g.debt], ["Savings", g.savings]].map(([label, v]) => {
          const text = "$" + money(v);
          return `<div class="stat"><span>${label}</span><b>${esc(text)}</b></div>`;
        }).join("")}
        <div class="stat"><span>Coat</span><b>${used}/${cap}</b><i class="bar"><i style="width:${cap > 0 ? Math.min(100, (used / cap) * 100) : 0}%"></i></i></div>
      </section>
      <ul class="market">${market}</ul>
      <footer class="dock"><button class="btn primary big" data-ctl="2031" ${interactive ? "" : "disabled"}>Jet</button></footer>`;
  }

  function jetScreen(frm) {
    const places = frm.objects.filter((o) => o.kind === "control" && o.id >= 2000 && o.id <= 2005);
    const cancel = frm.objects.find((o) => o.id === 9999 && o.visible);
    return `${header("Jet")}
      <p class="lead">Where to, dude?</p>
      <ul class="places">${places.map((o) => `<li><button class="place ${g.location === o.id ? "here" : ""}" data-ctl="${o.id}">
        <span>${esc(o.text)}</span>${g.location === o.id ? '<span class="chip">You are here</span>' : '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>'}</button></li>`).join("")}</ul>
      ${cancel ? `<footer class="dock"><button class="btn big" data-ctl="9999">Cancel</button></footer>` : ""}`;
  }

  function introScreen(frm) {
    // the Palm form indents continuation lines ("Created by" / "  Matthew Lee"): join them
    const lines = [];
    for (const o of frm.objects) {
      if (o.kind !== "label" || !o.text.trim()) continue;
      if (/^\s/.test(o.text) && lines.length) lines[lines.length - 1] += " " + o.text.trim();
      else lines.push(o.text.trim());
    }
    const [title, ...rest] = lines;
    // the form's own credit lines are replaced by the full credits (version/date lines stay)
    const info = rest.filter((l) => !/^(created|updated|based|web port) /i.test(l));
    return `<div class="splash">
      <img class="pixel hero" src="${imgSrc(9502)}" alt="">
      <h1>${esc(title || "DopeWars")}</h1>
      ${info.map((l) => `<p>${esc(l)}</p>`).join("")}
      ${CREDITS}
      <footer class="dock"><button class="btn primary big" data-ctl="9999">Continue</button></footer>
    </div>`;
  }

  function gameOverScreen(frm) {
    const cash = textAt(frm, 64, 20);
    const msg = [textAt(frm, 5, 35), textAt(frm, 5, 46)].filter(Boolean).join(" ");
    const scores = scoreRows(frm, 75);
    return `${header("Game Over")}
      <section class="result"><span>Final cash</span><b>$${esc(cash)}</b><p>${esc(msg)}</p></section>
      <h2 class="section-title">High Scores</h2>
      ${scoreTable(scores, "No high scores yet.")}
      <footer class="dock"><button class="btn primary big" data-ctl="9999">Start New Game</button></footer>`;
  }

  function scoreTable(scores, empty) {
    if (!scores.length) return `<p class="muted center">${esc(empty)}</p>`;
    return `<ol class="scores">${scores.map((s, i) => `<li class="${i === 0 ? "top-score" : ""}"><span class="rank">${i + 1}</span><span class="who">${esc(s.name.trim() || "—")}</span><b>$${esc(s.value)}</b></li>`).join("")}</ol>`;
  }

  function genericScreen(frm) {
    return `${header(frm.title && frm.title.trim() ? frm.title.trim() : "DopeWars")}
      <section class="card">${labels(frm).map((l) => `<p>${esc(l)}</p>`).join("")}</section>
      <footer class="dock">${btnRow(frm)}</footer>`;
  }

  function baseScreen(frm, interactive) {
    if (!frm) return `<div class="splash"><p class="muted">Loading…</p></div>`;
    switch (frm.id) {
      case 1000: return introScreen(frm);
      case 1002: return jetScreen(frm);
      case 1003: return mainScreen(frm, interactive);
      case 1007: return gameOverScreen(frm);
      default: return genericScreen(frm);
    }
  }

  // ---------------------------------------------------------------- overlays (alerts, dialogs, popups)
  function sheet(inner, cls = "") { return `<div class="backdrop"></div><div class="sheet ${cls}" role="dialog" aria-modal="true">${inner}</div>`; }

  function alertSheet(frm) {
    const a = frm.alert;
    const tone = { error: "danger", warning: "warn" }[a.type] || "info";
    return sheet(`<div class="sheet-head ${tone}"><span class="dot"></span><h2>${esc(a.title)}</h2></div>
      <p class="message">${esc(a.message).replace(/\n/g, "<br>")}</p>
      <div class="actions">${a.buttons.map((b, i) => `<button class="btn ${isPrimary(b) || a.buttons.length === 1 ? "primary" : ""}" data-ctl="${i}">${esc(b)}</button>`).join("")}</div>`);
  }

  function helpSheet(frm) {
    const paras = frm.help.split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
    return sheet(`<div class="sheet-head info"><span class="dot"></span><h2>Tips</h2></div><div class="scroll">${paras}</div>
      <div class="actions"><button class="btn primary" data-ctl="1">Done</button></div>`, "tall");
  }

  function highScoresSheet(frm) {
    const scores = scoreRows(frm, 15);
    return sheet(`<div class="sheet-head info"><span class="dot"></span><h2>High Scores</h2></div>
      ${scoreTable(scores, "There are no high scores.")}
      <div class="actions"><button class="btn primary" data-ctl="3001">OK</button></div>`);
  }

  function dialogSheet(frm) {
    const field = frm.objects.find((o) => o.kind === "field");
    const title = frm.title && frm.title.trim() ? frm.title.trim() : "DopeWars";
    const fieldHtml = field ? `<label class="field"><span class="prefix">${frm.objects.some((o) => o.kind === "label" && o.text.trim() === "$") ? "$" : ""}</span>
        <input data-field="${frm.uid}" ${field.numeric ? 'inputmode="numeric" pattern="[0-9]*"' : 'autocapitalize="words"'} maxlength="${field.maxChars}" value="${esc(field.text)}" autocomplete="off" enterkeyhint="done"></label>` : "";
    const lbls = labels(frm).filter((l) => l !== "$");
    // put the primary button last so it sits under the thumb
    const btns = buttons(frm).sort((a, b) => isPrimary(a.text) - isPrimary(b.text));
    return sheet(`<div class="sheet-head info"><span class="dot"></span><h2>${esc(title)}</h2></div>
      ${lbls.map((l) => `<p class="message">${esc(l)}</p>`).join("")}${fieldHtml}
      <div class="actions">${btns.map((b) => `<button class="btn ${isPrimary(b.text) ? "primary" : ""}" data-ctl="${b.id}">${esc(niceLabel(b.text))}</button>`).join("")}</div>`);
  }

  function overlay(frm) {
    if (!frm) return "";
    if (frm.alert) return alertSheet(frm);
    if (frm.help !== undefined) return helpSheet(frm);
    if (frm.id === 9111) return highScoresSheet(frm);
    return dialogSheet(frm);
  }

  function menuSheet() {
    const menus = PRC.menus[6000] || [];
    return sheet(`<div class="sheet-head info"><span class="dot"></span><h2>Menu</h2></div><div class="scroll">
      ${menus.map((m) => `<h3 class="menu-title">${esc(m.title)}</h3><div class="menu-group">${m.items.filter((it) => it.text !== "-")
        .map((it) => `<button class="menu-item" data-menu="${it.id}">${esc(it.text.trim())}</button>`).join("")}</div>`).join("")}
      </div><div class="actions"><button class="btn" data-act="close-menu">Close</button></div>`, "tall");
  }

  // ---------------------------------------------------------------- render loop
  function layers() {
    const v = P.view();
    const base = v.stack.length ? v.stack[0] : v.active;
    const over = v.stack.length ? [...v.stack.slice(1), v.active].filter(Boolean) : [];
    return { base, over };
  }
  function signature() {
    const { base, over } = layers();
    return [P.version, base && base.uid, over.map((f) => f.uid).join(","), menuOpen, g.cash, g.debt, g.savings,
      g.qty.join(), g.price.join(), g.coat, g.coatUsed, g.gun, g.days, g.locName, g.location].join("|");
  }
  function render() {
    const { base, over } = layers();
    const canMenu = base && base.id === 1003 && !over.length;
    if (!canMenu) menuOpen = false;
    const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.field;
    root.innerHTML = `<div class="screen">${baseScreen(base, !over.length)}</div>${over.map(overlay).join("")}${menuOpen ? menuSheet() : ""}`;
    // shrink long stat values (e.g. "$99999999", "1000/1000") just enough to fit their card
    for (const b of root.querySelectorAll(".stat b")) {
      for (let size = 15; b.scrollWidth > b.clientWidth && size > 9; size -= 0.5) b.style.fontSize = size - 0.5 + "px";
    }
    const input = root.querySelector("input[data-field]");
    if (input && (focused === input.dataset.field || !focused)) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
  function loop() {
    if (enabled) {
      const sig = signature();
      if (sig !== lastSig) { lastSig = sig; render(); }
    }
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- input
  root.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el || el.disabled) return;
    if (el.dataset.act === "menu") { menuOpen = true; lastSig = ""; return; }
    if (el.dataset.act === "close-menu") { menuOpen = false; lastSig = ""; return; }
    if (el.dataset.menu) {
      menuOpen = false;
      lastSig = "";
      P.EvtAddEvent({ eType: P.ev.menuEvent, itemID: Number(el.dataset.menu) });
      return;
    }
    if (el.dataset.ctl !== undefined) send(Number(el.dataset.ctl));
  });
  root.addEventListener("input", (e) => {
    const input = e.target.closest("input[data-field]");
    if (!input) return;
    const frm = P.view().active;
    const field = frm && frm.objects.find((o) => o.kind === "field");
    if (!field || String(frm.uid) !== input.dataset.field) return;
    let v = input.value;
    if (field.numeric) v = v.replace(/[^0-9]/g, "");
    v = v.slice(0, field.maxChars);
    if (v !== input.value) input.value = v;
    field.text = v;
    P.drawField(frm, field); // keep the Classic screen in step
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches("input[data-field]")) return;
    const ok = [...root.querySelectorAll(".sheet button[data-ctl]")].find((b) => /^ok$/i.test(b.textContent.trim()));
    if (ok) { e.preventDefault(); ok.click(); }
  });

  window.ModernView = {
    credits: CREDITS,
    setEnabled(on) {
      enabled = on;
      lastSig = "";
      if (on) { P.closeMenu(); render(); } else { menuOpen = false; root.innerHTML = ""; }
    },
  };
  requestAnimationFrame(loop);
})();
