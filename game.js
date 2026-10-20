// DopeWars 2.4.6 game logic, ported function-by-function from the 68k code in
// DopeWars2.4.6.prc (see notes/REVERSE_ENGINEERING.md; addresses are code_0001 offsets).
(function () {
  "use strict";
  const P = PalmOS;
  const { ev } = P;

  // ---------------------------------------------------------------- form / resource ids
  const F = { intro: 1000, start: 1001, jet: 1002, main: 1003, buy: 1004, sell: 1005, amount: 1006,
    gameOver: 1007, contact: 8000, highScores: 9111, newHighScore: 9150, borrow: 9994, repay: 9999 };
  const BRONX = 2000;
  const PREFS_KEY = "dopewars-2.4.6/prefs";
  const DB_KEY = "dopewars-2.4.6/DopeWarsDB";

  // ---------------------------------------------------------------- C-ish helpers
  const i16 = (v) => ((v << 16) >> 16);
  // __d_dtoi @45b4: truncate toward zero, saturate to int32
  const dtoi = (x) => (x >= 2147483648 ? 2147483647 : x <= -2147483649 ? -2147483648 : Math.trunc(x) | 0);
  const StrIToA = (n) => String(n | 0);
  const rand = () => P.SysRandom(0);
  const rmod = (n) => rand() % n; // ext.l + divs.w remainder (SysRandom is never negative)

  // ---------------------------------------------------------------- globals (A5 world)
  const g = {
    qty: new Int16Array(8),     // -0x78
    price: new Int32Array(8),   // -0x20
    cash: 0, debt: 0, savings: 0, // -0x68 -0x60 -0x58 (double)
    coat: 0,                    // -0x50
    gun: 0,                     // -0x4e  0 none / 1 gun / 2 shotgun
    coatUsed: 0,                // -0x4c
    location: 0,                // -0x4a  Jet control id
    days: 0,                    // -0x48
    cops: 0,                    // -0x46
    locName: "",                // -0x40
    cheated: 0,                 // -0x2c
    cheatMode: 0,               // -0x2a
    reminder: 0,                // -0x28
    showCodes: 0,               // -0x26
    travelled: 0,               // -0xaa
    curForm: 0,                 // -0xac
    contactReturn: 0,           // -0xa8
    buf: "",                    // -0xa0 scratch string
  };

  // ---------------------------------------------------------------- high score record (-0x138, 140 bytes)
  const HS = new Uint8Array(140);
  const hsView = new DataView(HS.buffer);
  const hsScore = (i) => hsView.getFloat64(i * 28 + 20);
  const setHsScore = (i, v) => hsView.setFloat64(i * 28 + 20, v);
  function cstrAt(off) { // read a C string out of the record, exactly as StrCopy would
    let s = "";
    for (let k = off; k < HS.length && HS[k]; k++) s += String.fromCharCode(HS[k]);
    return s;
  }
  function strcpyAt(off, s) {
    for (let k = 0; k < s.length && off + k < HS.length; k++) HS[off + k] = s.charCodeAt(k) & 0xff;
    if (off + s.length < HS.length) HS[off + s.length] = 0;
  }
  const hsName = (i) => cstrAt(i * 28);

  // ---------------------------------------------------------------- persistence
  function store(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* private mode */ } }
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  // OpenDatabase @08ee / SaveStatus @0ad6
  function OpenDatabase() {
    const saved = load(DB_KEY);
    if (!saved) {
      InitHighScores();
      SaveStatus();
      return;
    }
    const bin = atob(saved);
    for (let k = 0; k < 140; k++) HS[k] = bin.charCodeAt(k);
  }
  function SaveStatus() {
    store(DB_KEY, btoa(String.fromCharCode(...HS)));
  }

  // InitHighScores @0730
  function InitHighScores() {
    for (let i = 0; i <= 4; i++) {
      strcpyAt(i * 28, " ");
      setHsScore(i, 0);
    }
  }

  // InsertScore @0780
  function InsertScore(name, score) {
    for (let i = 0; i <= 4; i++) {
      if (score >= hsScore(i)) {
        for (let j = 4; j > i; j--) {
          setHsScore(j, hsScore(j - 1));
          strcpyAt(j * 28, cstrAt((j - 1) * 28));
        }
        setHsScore(i, score);
        strcpyAt(i * 28, name);
        return;
      }
    }
  }

  // GetHighScoreName @0848
  async function GetHighScoreName() {
    const frm = P.FrmInitForm(F.newHighScore);
    P.FrmSetFocus(frm, P.FrmGetObjectIndex(frm, 3000));
    await P.FrmDoDialog(frm);
    const text = P.FldGetTextPtr(P.FrmGetObjectPtr(frm, P.FrmGetObjectIndex(frm, 3000)));
    g.buf = text == null ? "-- No Name --" : text;
    InsertScore(g.buf, g.cash);
    P.FrmDeleteForm(frm);
  }

  // MakeScoreVerificationCode @04d4
  function MakeScoreVerificationCode(i) {
    const s = StrIToA(dtoi(hsScore(i))) + hsName(i);
    const buf = new Uint8Array(40);
    for (let k = 0; k < s.length && k < 40; k++) buf[k] = s.charCodeAt(k) & 0xff;
    for (let k = s.length; k <= 39; k++) buf[k] = k % 242;
    buf[39] = 0;
    let a = 0, b = 14, d = 0;
    do {
      const t = buf[a]; buf[a] = buf[b]; buf[b] = t;
      d += 0x53; a = (a + d) % 20;
      d += 0x57; b = (b + d) % 20;
      d -= 0xa9;
    } while (d <= 39);
    const K = [0xf2, 0xe6, 0x9a, 0x53, 0xaa, 0xf4, 0x21, 0xd4];
    for (let k = 0; k <= 39; k++) buf[k] = (buf[k] + K[k % 8]) & 0xff;
    let code = "";
    for (let k = 0; k <= 7; k++) code += String.fromCharCode((buf[k] & 0x0f) + 0x41);
    g.buf = code;
    return code;
  }

  // ---------------------------------------------------------------- number formatting
  // DoubleToString @4224: truncating, at most 17 integer digits, stops when fraction <= 1e-15
  function DoubleToString(x, decimals) {
    if (x === 0) return "0";
    let ip = Math.trunc(x);
    let frac = x - ip;
    let s = "";
    let n = 0;
    while (ip >= 1 && n <= 16) {
      const q = Math.trunc(ip / 10);
      s = String.fromCharCode(0x30 + dtoi(ip - q * 10)) + s;
      n++;
      ip = q;
    }
    if (decimals > 0) {
      s += ".";
      let k = 0;
      do {
        k++;
        if (!(frac > 1e-15)) break;
        frac *= 10;
        const digit = Math.trunc(frac);
        s += String.fromCharCode(0x30 + (digit & 0xff));
        frac -= digit;
      } while (k < decimals);
    }
    return s;
  }

  // The money block inside ProcessForm (main form, @1732...)
  function formatMoney(x) {
    const scaled = (v, suffix, allowFour) =>
      DoubleToString(v, v > 1000 ? 2 : v > 100 || !allowFour ? 3 : 4) + " " + suffix;
    if (x > 1e16) return scaled(x / 1e15, "Q", true);
    if (x > 1e13) return scaled(x / 1e12, "T", true);
    if (x > 1e10) return scaled(x / 1e9, "B", true);
    if (x > 1e8) return scaled(x / 1e6, "M", false);
    return DoubleToString(x, 0);
  }

  // ---------------------------------------------------------------- small helpers @0b2e..@13c4
  // makeDrugPrices @0b2e
  function makeDrugPrices(remove) {
    const p = g.price;
    p[0] = 1000 + rmod(3500);    // Acid
    p[1] = 15000 + rmod(15000);  // Cocaine
    p[2] = 10 + rmod(50);        // Ecstasy
    p[3] = 1000 + rmod(2500);    // PCP
    p[4] = 5000 + rmod(9000);    // Heroin
    p[5] = 300 + rmod(600);      // Weed
    p[6] = 600 + rmod(750);      // Shrooms
    p[7] = 70 + rmod(180);       // Speed
    for (let n = remove; n > 0; n--) p[rand() & 7] = 0;
  }

  // getDrugName @0c52: the names live on the main form's controls
  function getDrugName(i) {
    const frm = P.FrmGetFormPtr(F.main);
    if (!frm) return null;
    const o = P.FrmGetObjectPtr(frm, P.FrmGetObjectIndex(frm, 2000 + (i & 7)));
    return o ? P.CtlGetLabel(o) : null;
  }

  // setFieldNumeric @0cba
  function setFieldNumeric(formId, fieldId) {
    const frm = P.FrmGetFormPtr(formId);
    const idx = P.FrmGetObjectIndex(frm, fieldId);
    const fld = P.FrmGetObjectPtr(frm, idx);
    P.FldSetNumeric(fld);
    P.FldDelete(fld);
    P.FrmSetFocus(frm, idx);
  }

  // getFieldValue @0d4c: <=4 chars via StrAToI, longer strings parsed digit by digit as a double
  function getFieldValue(frm, fieldId) {
    const text = P.FldGetTextPtr(P.FrmGetObjectPtr(frm, P.FrmGetObjectIndex(frm, fieldId)));
    if (text == null) return 0;
    if (text.length <= 4) return parseInt(text, 10) || 0;
    let v = 0, mul = 1;
    for (let k = text.length - 1; k >= 0; k--) {
      v += (text.charCodeAt(k) - 0x30) * mul;
      mul *= 10;
    }
    return v;
  }

  // SetFieldHandle @0e38
  function SetFieldHandle(str, frm, fieldId, redraw) {
    P.FldSetText(frm, P.FrmGetObjectPtr(frm, P.FrmGetObjectIndex(frm, fieldId)), str, redraw);
  }

  // initGame @0ee4
  function initGame() {
    g.qty.fill(0);
    g.cash = 2000;
    g.debt = 5500;
    g.savings = 0;
    g.coat = 100;
    g.gun = 0;
    g.coatUsed = 0;
    g.location = 0;
    g.days = 31;
    g.cops = 3;
    g.cheated = 0;
    g.cheatMode = 0;
    g.locName = "No Name";
    makeDrugPrices(3);
    g.travelled = 0;
    g.reminder = 0;
  }

  // LoadApplicationState @0fd2 / SaveApplicationState @3b04 (app prefs 'DOPE' #0 v3)
  function LoadApplicationState() {
    let prefs = null;
    try { prefs = JSON.parse(load(PREFS_KEY)); } catch (e) { prefs = null; }
    if (!prefs || prefs.version !== 3) {
      initGame();
      g.curForm = F.intro;
      return;
    }
    Object.assign(g, {
      cash: prefs.cash, debt: prefs.debt, savings: prefs.savings, coat: prefs.coat, gun: prefs.gun,
      coatUsed: prefs.coatUsed, location: prefs.location, days: prefs.days, cops: prefs.cops,
      curForm: prefs.curForm, cheated: prefs.cheated, cheatMode: 0, locName: prefs.locName,
    });
    g.qty.set(prefs.qty);
    g.price.set(prefs.price);
  }
  function SaveApplicationState() {
    store(PREFS_KEY, JSON.stringify({
      version: 3, qty: [...g.qty], price: [...g.price], cash: g.cash, debt: g.debt,
      savings: g.savings, coat: g.coat, gun: g.gun, coatUsed: g.coatUsed, location: g.location,
      days: g.days, cops: g.cops, curForm: g.curForm, cheated: g.cheated, locName: g.locName,
    }));
  }

  // finishGame @10e8: liquidate everything at fresh prices
  function finishGame() {
    makeDrugPrices(0);
    g.cash = g.cash + (g.savings - g.debt);
    g.savings = 0;
    g.debt = g.savings;
    for (let i = 0; i <= 7; i++) {
      g.cash = g.cash + Math.imul(g.qty[i], g.price[i]);
      g.qty[i] = 0;
    }
  }

  const setCurrentWinTitle = (s) => P.FrmSetTitle(P.FrmGetActiveForm(), s);            // @11aa
  const setFormTitle = (formId, s) => P.FrmSetTitle(P.FrmGetFormPtr(formId), s);       // @11de
  function setLabelText(frm, id, s) {                                                  // @1226
    P.CtlSetLabelText(P.FrmGetObjectPtr(frm, P.FrmGetObjectIndex(frm, id)), s);
  }

  // DrawHighScores @1274 (bold font is only reset after the first drawn row)
  function DrawHighScores(y, showCode) {
    let clipY = y; // the clip rect only advances for rows that are drawn
    P.FntSetFont(1);
    for (let i = 0; i <= 4; i++, y += 12) {
      if (hsScore(i) < 1) continue;
      const name = hsName(i);
      P.WinSetClip({ x: 5, y: clipY, w: 88, h: 12 });
      P.WinDrawChars(name, name.length, 5, y);
      P.WinResetClip();
      clipY += 12;
      if (!showCode) {
        g.buf = StrIToA(dtoi(hsScore(i)));
        P.WinDrawChars("$", 1, 94, y);
        P.WinDrawChars(g.buf, g.buf.length, 100, y);
      } else {
        const code = MakeScoreVerificationCode(i);
        P.WinDrawChars(code, code.length, 100, y);
      }
      P.FntSetFont(0);
    }
  }

  // SetCancelButtonVisible @13c4
  function SetCancelButtonVisible(show) {
    const frm = P.FrmGetFormPtr(F.jet);
    const idx = P.FrmGetObjectIndex(frm, 9999);
    if (show) P.FrmShowObject(frm, idx); else P.FrmHideObject(frm, idx);
  }

  // ---------------------------------------------------------------- ProcessForm @158a
  function draw(s, x, y) { P.WinDrawChars(s, s.length, x, y); }

  function ProcessForm(formId) {
    if (formId === F.main) {
      P.FntSetFont(0);
      setCurrentWinTitle(g.locName);
      let total = 0;
      for (let i = 0, y = 20; y <= 123; i++, y += 13) {
        P.WinEraseRectangle({ x: 6, y, w: 18, h: 11 });
        P.WinEraseRectangle({ x: 75, y, w: 30, h: 11 });
        draw(StrIToA(g.qty[i]), 7, y);
        total = i16(total + g.qty[i]);
        draw(g.price[i] > 0 ? "$" + StrIToA(g.price[i]) : "   None", 69, y);
      }
      [[g.cash, 32], [g.debt, 58], [g.savings, 84]].forEach(([v, y]) => {
        P.WinEraseRectangle({ x: 115, y, w: 40, h: 11 });
        draw(formatMoney(v), 115, y);
      });
      P.WinEraseRectangle({ x: 115, y: 110, w: 40, h: 11 });
      draw(StrIToA(total) + "/" + StrIToA(g.coat), 110, 110);
      P.WinEraseRectangle({ x: 6, y: 125, w: 150, h: 11 });
      draw("Time remaining: " + StrIToA(g.days) + " days", 7, 126);
      if (g.gun !== 0) {
        P.FntSetFont(1);
        if (g.gun === 2) {
          draw("Shot", 122, 126);
          draw("Gun", 123, 136);
        } else {
          draw("Gun", 123, 126);
        }
        P.FntSetFont(0);
      }
      g.coatUsed = total;
    } else if (formId === F.buy) {
      setFieldNumeric(formId, 3000);
    } else if (formId === F.gameOver) {
      P.FntSetFont(1);
      g.buf = StrIToA(dtoi(g.cash));
      draw(g.buf, 64, 20);
      P.FntSetFont(0);
      let l1, l2;
      if (g.cops === -1) [l1, l2] = ["You're dead.", "Congratulations."];
      else if (g.cash < 0) [l1, l2] = ["The Loan Shark's thugs broke your", "legs."];
      else if (g.cash >= 1e12) [l1, l2] = ["You retired filthy rich in the", "Carribbean."];
      else if (g.cash >= 1e9) [l1, l2] = ["You retired a billionaire in the", "Carribbean."];
      else if (g.cash >= 1e6) [l1, l2] = ["You retired a millionaire in the", "Carribbean."];
      else if (g.cash > 2000) [l1, l2] = ["Congratulations!", "You didn't do half bad."];
      else [l1, l2] = ["You didn't make any money!", "Better luck next time."];
      draw(l1, 5, 35);
      draw(l2, 5, 46);
      DrawHighScores(75, 0);
      P.FntSetFont(0);
    } else if (formId === F.highScores) {
      DrawHighScores(15, g.showCodes);
      if (hsScore(0) === 0) {
        P.FntSetFont(1);
        draw("There are no high scores.", 16, 40);
      }
      P.FntSetFont(0);
    } else if (formId === F.jet) {
      SetCancelButtonVisible(g.location !== 0);
      if (g.location !== 0) {
        P.FntSetFont(1);
        const w = P.FntCharsWidth(g.locName, 1) + 70;
        const x = 80 - (w >> 1);
        P.FntSetFont(0);
        draw("Current location: ", x, 123);
        P.FntSetFont(1);
        draw(g.locName, x + 70, 123);
        P.FntSetFont(0);
      }
    }
  }

  // ---------------------------------------------------------------- buy / sell
  // NegotiateBuy @2446
  async function NegotiateBuy(i) {
    let done = false;
    let n = 0;
    const frm = P.FrmInitForm(F.buy);
    setFieldNumeric(F.buy, 3000);
    setFormTitle(F.buy, "Buy " + getDrugName(i));
    const afford = dtoi(g.cash / g.price[i]);
    g.buf = "At $" + StrIToA(g.price[i]) + " each, you can afford " + (afford <= 999 ? StrIToA(afford) + "." : "a lot.");
    setLabelText(frm, 4000, g.buf);
    while (!done) {
      const btn = await P.FrmDoDialog(frm);
      if (btn === 3001 || btn === 0) {
        done = true;
        n = 0;
        break;
      }
      n = btn === 3003 ? afford : dtoi(getFieldValue(frm, 3000));
      if (Math.imul(n, g.price[i]) > g.cash) {
        await P.FrmAlert(9009);
        continue;
      }
      if (g.coat < g.coatUsed + n) n = g.coat - g.coatUsed; // silently capped to free space
      done = true;
    }
    P.FrmDeleteForm(frm);
    g.cash = g.cash - Math.imul(n, g.price[i]);
    g.qty[i] = i16(g.qty[i] + n);
  }

  // NegotiateSell @26da
  async function NegotiateSell(i) {
    let done = false;
    let n = 0;
    const frm = P.FrmInitForm(F.sell);
    setFieldNumeric(F.sell, 3000);
    setFormTitle(F.sell, "Sell " + getDrugName(i));
    g.buf = "You can sell up to " + StrIToA(g.qty[i]) + " at $" + StrIToA(g.price[i]) + " each.";
    setLabelText(frm, 4000, g.buf);
    const have = g.qty[i];
    while (!done) {
      const btn = await P.FrmDoDialog(frm);
      if (btn === 3001 || btn === 0) {
        done = true;
        n = 0;
        break;
      }
      n = btn === 3003 ? have : dtoi(getFieldValue(frm, 3000));
      if (g.qty[i] - n < 0) {
        await P.FrmAlert(9008);
        continue;
      }
      done = true;
    }
    P.FrmDeleteForm(frm);
    g.cash = g.cash + Math.imul(n, g.price[i]);
    g.qty[i] = i16(g.qty[i] - n);
  }

  // BuyDrugs @28a8
  async function BuyDrugs(i) {
    if (g.price[i] === 0) return P.FrmAlert(9003);
    if (g.price[i] > g.cash) return P.FrmAlert(9005);
    if (g.coatUsed + 1 > g.coat) return P.FrmAlert(9007);
    return NegotiateBuy(i);
  }

  // SellDrugs @2992
  async function SellDrugs(i) {
    if (!(g.qty[i] > 0)) return P.FrmAlert(9006);
    if (g.price[i] === 0) return P.FrmAlert(9004);
    return NegotiateSell(i);
  }

  // getLocationName @292e
  function getLocationName(ctlId) {
    if (ctlId === g.location) return 0;
    const frm = P.FrmGetFormPtr(F.jet);
    g.locName = P.CtlGetLabel(P.FrmGetObjectPtr(frm, P.FrmGetObjectIndex(frm, ctlId)));
    g.location = ctlId;
    return 1;
  }

  // ---------------------------------------------------------------- Loan Shark @2a2c
  async function amountTimes1000(frm, fieldId) {
    const v = dtoi(getFieldValue(frm, fieldId) * 1000);
    SetFieldHandle(StrIToA(v), frm, fieldId, false);
  }

  async function VisitShark() {
    let borrowed = 0;
    let choice;
    do {
      // (the original also leaks a fresh FrmInitForm(1003) here each pass; it has no visible effect)
      choice = await P.FrmAlert(9105);
      if (choice === 1) {
        // repay
        if (g.debt < 1) { await P.FrmAlert(9012); continue; }
        let done = 0, v = 0;
        const frm = P.FrmInitForm(F.repay);
        setFieldNumeric(F.repay, 9997);
        setLabelText(frm, 9998, "How much would you like to repay?");
        while (!done) {
          const btn = await P.FrmDoDialog(frm);
          if (btn === 0 || btn === 3001) { done = 1; v = 0; }
          else if (btn === 9995) {
            if (g.cash < g.debt) await P.FrmAlert(9009);
            else { done = 1; v = g.debt; }
          } else if (btn === 3002) {
            v = getFieldValue(frm, 9997);
            if (v < 0) continue;
            if (g.cash - v < 0) await P.FrmAlert(9009);
            else if (g.debt - v < 0) await P.FrmAlert(9010);
            else break;
          } else if (btn === 3003) {
            await amountTimes1000(frm, 9997);
            v = 0;
          }
        }
        P.FrmDeleteForm(frm);
        g.debt = g.debt - v;
        g.cash = g.cash - v;
        ProcessForm(F.main);
      } else if (choice === 2) {
        // borrow
        if (borrowed === 1) { await P.FrmAlert(9016); continue; }
        let max = g.cash * 30;
        if (max < 5500) max = 5500;
        if (max > 1e9) max = 1e9;
        let done = 0, v = 0;
        const frm = P.FrmInitForm(F.borrow);
        setFieldNumeric(F.borrow, 9992);
        setLabelText(frm, 9993, "How much would you like to borrow?");
        while (!done) {
          const btn = await P.FrmDoDialog(frm);
          if (btn === 0 || btn === 3001) { done = 1; v = 0; }
          else if (btn === 9990) { done = 1; v = max; }
          else if (btn === 3002) {
            v = getFieldValue(frm, 9992);
            if (v < 0) continue;
            if (v > max) {
              g.buf = StrIToA(dtoi(max));
              await P.FrmCustomAlert(9015, g.buf, " ", " ");
            } else { done = 1; }
          } else if (btn === 3003) {
            await amountTimes1000(frm, 9992);
            v = 0;
          }
        }
        P.FrmDeleteForm(frm);
        g.debt = g.debt + v;
        g.cash = g.cash + v;
        if (done === 1) borrowed = 1; // any way out of the dialog uses up today's loan
        ProcessForm(F.main);
      }
    } while (choice !== 0);
  }

  // ---------------------------------------------------------------- Bank @2ecc
  async function VisitBank() {
    let choice;
    do {
      choice = await P.FrmAlert(9104);
      if (choice !== 1 && choice !== 2) break;
      const withdraw = choice === 1;
      let done = 0, v = 0;
      const frm = P.FrmInitForm(F.amount);
      setFieldNumeric(F.amount, 3000);
      setLabelText(frm, 4000, withdraw ? "How much would you like to withdraw?" : "How much would you like to deposit?");
      while (!done) {
        const btn = await P.FrmDoDialog(frm);
        if (btn === 3001 || btn === 0) { done = 1; v = 0; }
        else if (btn === 3003) { await amountTimes1000(frm, 3000); v = 0; }
        else {
          v = getFieldValue(frm, 3000);
          if (v < 0) continue;
          if (withdraw && g.savings - v < 0) await P.FrmAlert(9011);
          else if (!withdraw && v > g.cash) await P.FrmAlert(9009);
          else done = 1;
        }
      }
      P.FrmDeleteForm(frm);
      if (withdraw) { g.savings = g.savings - v; g.cash = g.cash + v; }
      else { g.savings = g.savings + v; g.cash = g.cash - v; }
      ProcessForm(F.main);
    } while (choice !== 0);
  }

  // ---------------------------------------------------------------- VerifyScoreDialog @3182
  async function VerifyScoreDialog() {
    if (hsScore(0) === 0) return P.FrmAlert(9017);
    let i = 0, btn;
    do {
      const score = StrIToA(dtoi(hsScore(i)));
      const code = MakeScoreVerificationCode(i);
      btn = await P.FrmCustomAlert(9112, hsName(i), score, code);
      if (btn === 1) {
        do { i--; if (i < 0) i = 4; } while (hsScore(i) === 0);
      } else if (btn === 2) {
        do { i++; if (i > 4) i = 0; } while (hsScore(i) === 0);
      }
    } while (btn !== 0);
  }

  // ---------------------------------------------------------------- police @32e4
  const DEPUTIES = ["", "and one of his deputies ", "and two of his deputies ", "and three of his deputies ", "and four of his deputies "];

  async function FuzzEncounter() {
    let alertId = 9108;
    let outcome = 0; // 0 still chasing, 1 over, 2 busted
    if (g.cops <= 0) return;
    while (outcome === 0) {
      let s1 = "", s2 = "is ";
      if (g.cops >= 2 && g.cops <= 5) { s1 = DEPUTIES[g.cops - 1]; s2 = "are "; }
      const btn = await P.FrmCustomAlert(alertId, s1, s2, "");
      if (btn === 0) { // Run
        if (rmod(3) !== 0) { outcome = 1; await P.FrmAlert(9020); }
        else if (rmod(5) === 0) { outcome = 2; await P.FrmAlert(9026); }
        else { outcome = 0; alertId = 9024; }
      } else if (btn === 1) { // Fight
        if (g.gun === 0) { await P.FrmAlert(9014); continue; }
        if ((rand() & 3) === 0) {
          if (g.gun === 2) {
            if (g.cops <= 1) { await P.FrmAlert(1004); g.cops = 0; }
            else { await P.FrmAlert(1003); g.cops = i16(g.cops - 2); }
          } else {
            await P.FrmAlert(9022);
            g.cops = i16(g.cops - 1);
          }
          if (g.cops <= 0) { outcome = 1; break; }
          alertId = 9024;
        } else {
          await P.FrmAlert(9021);
          alertId = 9024;
        }
        // the cops shoot back
        if (rmod(5) === 0) {
          if (rmod(5) === 0) {
            await P.FrmAlert(9023);
            g.days = 0;
            g.cops = -1;
            outcome = 1;
          } else {
            await P.FrmAlert(9028);
            outcome = 2;
          }
        } else {
          await P.FrmAlert(9025);
        }
      }
    }
    if (outcome === 2) {
      await P.FrmAlert(9027);
      g.qty.fill(0);
      g.cash = g.cash * 0.5;
      ProcessForm(F.main);
    }
  }

  // ---------------------------------------------------------------- random events @3550
  async function DoRandomStuff() {
    let weedBust = 5;   // cleared when event 0 fires: then event 13 is skipped (sic)
    let ecstasyBust = 5; // set to 3 when event 3 fires: then event 14 is skipped (sic)
    const events = PRC.events;
    for (let i = 0; i <= 16; i++) {
      const e = events[i];
      if (rmod(e.odds) !== 0) continue;
      if (weedBust === 0 && i === 13) continue;
      if (ecstasyBust === 3 && i === 14) continue;
      if (g.price[e.drug] === 0) continue;
      await P.FrmCustomAlert(9200, e.msg, " ", " ");
      if (e.mul > 0) g.price[e.drug] = Math.imul(g.price[e.drug], e.mul);
      if (e.div > 0) g.price[e.drug] = Math.trunc(g.price[e.drug] / e.div);
      let free = e.free;
      if (g.coat < free + g.coatUsed) free = g.coat - g.coatUsed;
      g.qty[e.drug] = i16(g.qty[e.drug] + free);
      ProcessForm(F.main);
      if (i === 0) weedBust = 0;
      if (i === 3) ecstasyBust = 3;
    }
  }

  // ---------------------------------------------------------------- DoTravel @3682
  async function DoTravel() {
    if (g.days <= 30 || (g.days <= 364 && g.cheated !== 0)) g.debt = g.debt + g.debt * 0.125;
    g.savings = g.savings + g.savings * 0.0625;
    g.days = i16(g.days - 1);
    ProcessForm(F.main);
    if (rmod(7) === 0 && g.days !== 0 && g.coatUsed !== 0) await FuzzEncounter();
    if (g.days === 0) {
      finishGame();
      g.travelled = 0;
      OpenDatabase();
      if (g.cash >= hsScore(4) && g.cheated === 0) await GetHighScoreName();
      SaveStatus();
      P.FrmGotoForm(F.gameOver);
      return;
    }
    if ((rand() & 7) === 0 && (await P.FrmAlert(9103)) === 1) {
      if (g.cash < 200) await P.FrmAlert(9009);
      else { g.cash = g.cash - 200; g.coat = i16(g.coat + 40); ProcessForm(F.main); }
    }
    if (g.gun === 0 && rmod(5) === 0 && (await P.FrmAlert(9102)) === 1) {
      if (g.cash < 400) await P.FrmAlert(9009);
      else { g.cash = g.cash - 400; g.gun = 1; ProcessForm(F.main); }
    }
    if (g.gun === 1 && rmod(6) === 0 && (await P.FrmAlert(1001)) === 1) {
      if (g.cash < 800) await P.FrmAlert(9009);
      else {
        g.cash = g.cash - 800;
        g.gun = 2;
        g.cops = i16(g.cops + 2);
        await P.FrmAlert(1002);
        ProcessForm(F.main);
      }
    }
    await DoRandomStuff();
    if (g.debt > 100000) {
      if (g.reminder === 2) { await P.FrmAlert(1000); g.reminder = 0; }
      else g.reminder++;
    }
    if (g.location === BRONX) {
      if ((await P.FrmAlert(9100)) === 1) await VisitShark();
      if ((await P.FrmAlert(9101)) === 1) await VisitBank();
    }
    g.travelled = 0;
  }

  // ---------------------------------------------------------------- ProcessControl @39a8
  async function ProcessControl(formId, ctlId) {
    if (formId === F.main) {
      if (ctlId >= 2010 && ctlId <= 2019) { await SellDrugs(ctlId % 10); ProcessForm(formId); }
      else if (ctlId >= 2020 && ctlId <= 2029) { await BuyDrugs(ctlId % 10); ProcessForm(formId); }
      else if (ctlId === 2030) await P.FrmAlert(9107);
      else if (ctlId === 2032) await P.FrmAlert(9106);
      else if (ctlId === 2031) P.FrmGotoForm(F.jet);
    } else if (formId === F.jet) {
      if (ctlId === 9999) {
        g.curForm++;
        P.FrmGotoForm(g.curForm);
      } else if (ctlId >= 2000 && ctlId <= 2009) {
        if (getLocationName(ctlId)) g.travelled = 1;
        P.FrmGotoForm(F.main);
      }
    } else if (formId === F.highScores && ctlId === 3001) {
      g.curForm = F.main;
      P.FrmReturnToForm(F.main);
    }
  }

  // ---------------------------------------------------------------- event handlers
  async function openForm(e) {
    P.FrmDrawForm(P.FrmGetActiveForm());
    if (g.travelled) makeDrugPrices(3);
    g.curForm = e.formID;
    ProcessForm(g.curForm);
    if (g.travelled) await DoTravel();
  }

  // simpleFormEvent @3d02 (intro, start, game over, contact)
  async function simpleFormEvent(e) {
    if (e.eType === ev.frmOpenEvent) { await openForm(e); return true; }
    if (e.eType !== ev.ctlSelectEvent) return false;
    if (e.controlID === 8001) {
      P.FrmGotoForm(g.contactReturn);
      g.contactReturn = 0;
      return false;
    }
    if (g.location === 0 && g.curForm === F.jet) return false;
    const old = g.curForm;
    g.curForm = old + 1;
    if (old === F.intro) g.curForm = F.jet;
    if (g.curForm > 1005) initGame();
    if (g.curForm > F.main) g.curForm = F.jet;
    if (g.location !== 0) g.curForm = F.main;
    P.FrmGotoForm(g.curForm);
    return true;
  }

  // HighScoreDialog @3dd8
  function HighScoreDialog() {
    g.showCodes = 0;
    P.FrmPopupForm(F.highScores);
  }

  // KeyDownHandler @3e04: write "¥" then a letter
  function KeyDownHandler(chr) {
    if (chr === 0xa5) {
      g.buf = "Cheat";
      P.FntSetFont(1);
      P.WinDrawChars(g.buf, 5, 120, 136);
      P.FntSetFont(0);
      g.cheatMode = 1;
      return;
    }
    if (g.cheatMode !== 1) { g.cheatMode = 0; return; }
    let setsCheated = true;
    switch (String.fromCharCode(chr)) {
      case "c": g.cash = g.cash + 10000000; break;
      case "p": g.cops = 0; break;
      case "t": g.coat = 1000; break;
      case "d": g.debt = 0; break;
      case "g": g.gun = 1; break;
      case "l": g.days = 365; break;
      case "s": g.days = 1; setsCheated = false; break;
      default: g.cheatMode = 0; setsCheated = false;
    }
    if (setsCheated) g.cheated = 1;
    if (g.cheated && g.cheatMode) {
      g.cheatMode = 0;
      P.FrmGotoForm(g.curForm);
    }
  }

  const HELP = { 6000: 5000, 6001: 5001, 6002: 5003, 6003: 5004, 6004: 5007, 6005: 5002, 6007: 5008 };

  // controlFormEvent @3f4e (jet, main, buy/sell..., high score popup)
  async function controlFormEvent(e) {
    switch (e.eType) {
      case ev.frmOpenEvent: await openForm(e); return true;
      case ev.keyDownEvent: KeyDownHandler(e.chr); return true;
      case ev.ctlSelectEvent: await ProcessControl(g.curForm, e.controlID); return true;
      case ev.menuEvent: break;
      default: return false;
    }
    const id = e.itemID;
    switch (id) {
      case 5000:
        if ((await P.FrmAlert(9109)) === 1) { initGame(); P.FrmGotoForm(F.jet); }
        break;
      case 5001:
        if ((await P.FrmAlert(9110)) === 1) { OpenDatabase(); InitHighScores(); SaveStatus(); }
        break;
      case 5002: OpenDatabase(); HighScoreDialog(); break;
      case 5003: OpenDatabase(); await VerifyScoreDialog(); break;
      case 6006: P.FrmGotoForm(F.intro); break;
      case 6008: g.contactReturn = P.FrmGetActiveFormID(); P.FrmGotoForm(F.contact); break;
      case 7000: g.cash = g.cash + 10000000; g.cheated = 1; break;
      case 7001: g.cops = 0; g.cheated = 1; break;
      case 7002: g.coat = 1000; g.cheated = 1; break;
      case 7003: g.debt = 0; g.cheated = 1; break;
      case 7004: g.gun = 1; g.cheated = 1; break;
      case 7005: g.days = 365; g.cheated = 1; break;
      case 7006: g.days = 60; g.cheated = 1; break;
      case 7007: g.days = 90; g.cheated = 1; break;
      default: if (HELP[id]) await P.FrmHelp(HELP[id]);
    }
    if (id > 6999 && g.cheated === 1) {
      g.cheatMode = 0;
      P.FrmGotoForm(g.curForm);
    }
    return false;
  }

  // ---------------------------------------------------------------- PilotMain / EventLoop @3aba @3c4e
  async function EventLoop() {
    for (;;) {
      const e = await P.EvtGetEvent();
      if (e.eType === ev.appStopEvent) break;
      if (e.eType === ev.frmLoadEvent) {
        const frm = P.FrmInitForm(e.formID);
        P.FrmSetActiveForm(frm);
        const simple = [F.intro, F.start, F.gameOver, F.contact].includes(e.formID);
        P.FrmSetEventHandler(frm, simple ? simpleFormEvent : controlFormEvent);
      }
      await P.FrmDispatchEvent(e);
    }
    SaveApplicationState();
  }

  async function PilotMain() {
    // fresh A5 world each launch: the high-score table is only read by OpenDatabase calls
    HS.fill(0);
    Object.assign(g, { travelled: 0, reminder: 0, contactReturn: 0, showCodes: 0, cheatMode: 0 });
    LoadApplicationState();
    P.FrmGotoForm(g.curForm);
    await EventLoop();
  }

  window.DopeWars = { PilotMain, SaveApplicationState, state: g, highScores: HS, formatMoney, DoubleToString, MakeScoreVerificationCode };
})();
