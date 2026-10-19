// =====================================================================
// Teph Seal Budgets — the whole app (plain JavaScript, no build step).
// Sections, in order:
//   1. Setup & helpers        5. Sheets (pop-up panels)
//   2. App state              6. Saving data (Supabase calls)
//   3. Budget math            7. Shell: tabs, render, clicks
//   4. Screens (views)        8. Login & startup
// =====================================================================
(function () {
"use strict";

/* ---------- 1. Setup & helpers ---------- */
const CFG = window.APP_CONFIG || {};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
const money2 = (n) => (n < 0 ? "−" : "") + "$" + Math.abs(Number(n)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (n) => String(n).padStart(2, "0");
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, "")); return isFinite(n) ? n : 0; };
const today = new Date();
const todayISO = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const WATCH_AT = CFG.WATCH_AT || 0.9;
const ROLE = { manager: "Area Manager", district: "District (sees all)", admin: "Admin" };
// Pay screen quick buttons — edit these lists to change the big buttons.
const QUICK_HOURS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
const QUICK_DOLLARS = [10, 20, 25, 50, 75, 100, 150, 200];
const PAY_REASONS = ["Extra job", "Redo / comeback", "Coverage", "Rush job", "Bonus", "Other"];
const round2 = (n) => Math.round(n * 100) / 100;

document.title = CFG.APP_NAME || document.title;
$("#appName").textContent = CFG.APP_NAME || "Budgets";

if (!window.supabase || !CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("YOUR-")) {
  $("#view").innerHTML = `<div class="card setup"><h2>Almost there</h2><p class="hint">Add your Supabase Project URL and publishable key to <b>js/config.js</b>, then reload. See SETUP.md, step 5.</p></div>`;
  $("#who").textContent = "Not connected";
  return;
}
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

/* ---------- 2. App state ---------- */
const S = {
  mode: "loading",          // loading | login | locked | admin | district | manager
  me: null,                 // my profile row
  cats: [], stores: [], budgets: {}, people: {}, spend: [], moves: [], employees: [],
  pay: { storeId: null, catId: null, empId: null, mode: "hours", qty: "", reason: "Extra job", note: "", date: todayISO, other: { first: "", init: "", rate: "" } },
  tab: null,
  month: new Date(today.getFullYear(), today.getMonth(), 1),
  cat: "all", group: "manager", sheet: null, loadedFor: null,
  payView: "log", queue: [], entered: [], queueErr: "",   // admin payroll list
};

/* ---------- 3. Budget math ---------- */
const activeCats = () => S.cats.filter((c) => !c.archived);
const catName = (id) => (S.cats.find((c) => c.id === id) || { name: "Removed category" }).name;
const monthStart = (d = S.month) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-01";
const nextMonthStart = () => monthStart(new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1));
const monthLabel = () => S.month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
const isAdmin = () => S.mode === "admin";
const seesAll = () => S.mode === "admin" || S.mode === "district";
const visibleStores = () => (seesAll() ? S.stores : S.stores.filter((s) => s.manager_id === S.me.id));
const canMove = () => isAdmin() || (S.mode === "manager" && S.me.can_move);
const nameOf = (uid) => !uid ? "Unassigned" : uid === S.me?.id ? "You" : (S.people[uid]?.full_name || S.people[uid]?.email || "Former team member");
const storeName = (id) => (S.stores.find((s) => s.id === id) || { name: "Removed store" }).name;
const filterCats = () => (S.cat === "all" ? null : [S.cat]);
const payCats = () => activeCats().filter((c) => c.pays_people);
const purchaseCats = () => activeCats().filter((c) => !c.pays_people);
const empName = (e) => `${e.first_name} ${e.last_initial}.`;
const canEditEmps = (storeId) => isAdmin() || (S.mode === "manager" && S.stores.some((s) => s.id === storeId && s.manager_id === S.me.id));

function budgetOf(store, catIds) {
  const ids = catIds || activeCats().map((c) => c.id);
  const base = S.budgets[store.id] || {};
  let b = 0;
  ids.forEach((c) => { b += num(base[c]); });
  S.moves.forEach((m) => {
    if (!ids.includes(m.category_id)) return;
    if (m.to_store === store.id) b += num(m.amount);
    if (m.from_store === store.id) b -= num(m.amount);
  });
  return b;
}
function spentOf(storeIds, catIds) {
  const ids = catIds || activeCats().map((c) => c.id), set = new Set(storeIds);
  return S.spend.reduce((a, e) => a + (set.has(e.store_id) && ids.includes(e.category_id) ? num(e.amount) : 0), 0);
}
function pace() {
  const y = S.month.getFullYear(), m = S.month.getMonth(), days = new Date(y, m + 1, 0).getDate();
  if (y === today.getFullYear() && m === today.getMonth()) return { pct: today.getDate() / days, day: today.getDate(), days, now: true };
  return S.month < new Date(today.getFullYear(), today.getMonth(), 1) ? { pct: 1, day: days, days } : { pct: 0, day: 0, days };
}
function status(spent, budget, p) {
  if (budget <= 0) return spent > 0 ? "bad" : "good";
  const r = spent / budget;
  if (r > 1) return "bad";
  if (r > WATCH_AT || (p > 0 && r - p > 0.12)) return "warn";
  return "good";
}
const STXT = { good: "On pace", warn: "Watch", bad: "Over" };
function bar(spent, budget, p, cls) {
  const w = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent ? 100 : 0;
  return `<div class="bar" role="img" aria-label="${money(spent)} of ${money(budget)} used"><i class="${cls}" style="width:${w}%"></i>${p > 0 && p < 1 ? `<span class="pace" style="left:calc(${p * 100}% - 1px)"></span>` : ""}</div>`;
}
const rank = (s) => { const fc = filterCats(), b = budgetOf(s, fc), sp = spentOf([s.id], fc); return b > 0 ? sp / b : sp ? 9 : 0; };

/* ---------- 4. Screens ---------- */
function heroBlock(stores, title) {
  const p = pace(), fc = filterCats(), ids = stores.map((s) => s.id);
  const budget = stores.reduce((a, s) => a + budgetOf(s, fc), 0), spent = spentOf(ids, fc), left = budget - spent, st = status(spent, budget, p.pct);
  const proj = p.now && p.pct > 0.06 ? spent / p.pct : null;
  const over = stores.filter((s) => spentOf([s.id], fc) > budgetOf(s, fc)).length;
  const paceTxt = p.pct === 0 ? "Month hasn't started" : p.pct === 1 ? "Month closed" : `Day ${p.day} of ${p.days}`;
  return `<section class="hero" aria-label="Totals">
    <div class="label">${esc(title)}${S.cat !== "all" ? " · " + esc(catName(S.cat)) : ""}</div>
    <div><div class="hero-big num">${money(left)}</div><div class="hero-sub">left · ${money(spent)} spent of ${money(budget)}</div></div>
    ${bar(spent, budget, p.pct, st)}
    <div class="legend"><span>${paceTxt}${p.now ? " · line shows where spend should be" : ""}</span><span>${budget > 0 ? Math.round((spent / budget) * 100) : 0}% used</span></div>
    <div class="hero-stats">
      <div><span class="label">Projected</span><b class="num ${proj && proj > budget ? "bad" : ""}">${proj ? money(proj) : "—"}</b></div>
      <div><span class="label">Stores</span><b class="num">${stores.length}</b></div>
      <div><span class="label">Over budget</span><b class="num ${over ? "bad" : ""}">${over}</b></div>
    </div></section>`;
}
function catChips() {
  return `<div class="chips" role="group" aria-label="Category filter">
    <button class="chip" data-cat="all" aria-pressed="${S.cat === "all"}">All categories</button>
    ${activeCats().map((c) => `<button class="chip" data-cat="${esc(c.id)}" aria-pressed="${S.cat === c.id}">${esc(c.name)}</button>`).join("")}</div>`;
}
function catCards(stores) {
  const p = pace(), ids = stores.map((s) => s.id);
  return `<section class="cats" aria-label="By category">${activeCats().map((c) => {
    const b = stores.reduce((a, s) => a + budgetOf(s, [c.id]), 0), sp = spentOf(ids, [c.id]);
    return `<button class="cat" data-cat="${esc(c.id)}"><div class="label">${esc(c.name)}</div><div class="cat-amt num ${sp > b ? "bad" : ""}">${money(b - sp)}</div><div class="cat-of num">left of ${money(b)}</div>${bar(sp, b, p.pct, status(sp, b, p.pct))}</button>`;
  }).join("")}</section>`;
}
function storeRow(s, showMgr) {
  const p = pace(), fc = filterCats(), sp = spentOf([s.id], fc), b = budgetOf(s, fc), k = status(sp, b, p.pct);
  return `<button class="row" data-store="${esc(s.id)}">
    <div style="min-width:0"><div class="row-name">${esc(s.name)}</div><div class="row-meta">${showMgr ? esc(nameOf(s.manager_id)) : money(b - sp) + " left"}</div></div>
    <div class="right"><div class="row-amt num">${money(sp)} / ${money(b)}</div><span class="pill ${k}">${STXT[k]}</span></div>
    ${bar(sp, b, p.pct, k)}</button>`;
}
function alertsBlock(stores) {
  const p = pace(), fc = filterCats();
  const hot = stores.map((s) => { const sp = spentOf([s.id], fc), b = budgetOf(s, fc); return { s, sp, b, k: status(sp, b, p.pct) }; })
    .filter((x) => x.k !== "good").sort((a, b) => rank(b.s) - rank(a.s));
  if (!hot.length) return "";
  return `<section class="sec"><div class="sec-head"><h2>Needs attention</h2><span class="hint">${hot.length} store${hot.length > 1 ? "s" : ""}</span></div>
  <div class="alerts">${hot.slice(0, 6).map((x) => `<button class="alert ${x.k === "warn" ? "warn" : ""}" data-store="${esc(x.s.id)}"><span><b>${STXT[x.k]}</b> · ${esc(x.s.name)}${seesAll() ? ` <span class="hint">· ${esc(nameOf(x.s.manager_id))}</span>` : ""}</span><span class="num">${x.k === "bad" ? money(x.sp - x.b) + " over" : Math.round((x.sp / (x.b || 1)) * 100) + "% used"}</span></button>`).join("")}</div></section>`;
}
function recentBlock(stores) {
  const ids = new Set(stores.map((s) => s.id));
  const items = [
    ...S.spend.filter((e) => ids.has(e.store_id)).map((e) => ({ t: "s", e })),
    ...S.moves.filter((m) => ids.has(m.from_store) || ids.has(m.to_store)).map((m) => ({ t: "m", e: m })),
  ].sort((a, b) => String(b.e.created_at).localeCompare(String(a.e.created_at))).slice(0, 8);
  return `<section class="sec"><div class="sec-head"><h2>Latest activity</h2><button class="btn ghost sm" data-act="csv">Export ${esc(S.month.toLocaleDateString("en-US", { month: "short" }))} CSV</button></div>
  <div class="list">${items.length ? items.map((x) => (x.t === "s" ? txRow(x.e, false) : moveRow(x.e))).join("") : `<div class="empty">Nothing logged for ${monthLabel()} yet.</div>`}</div></section>`;
}
function txRow(e, inStore) {
  const d = e.spent_on ? new Date(e.spent_on + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  const canDel = isAdmin() || (e.created_by === S.me.id && !e.processed);
  const title = e.employee_name ? `${esc(e.employee_name)} · ${esc(e.item || "Pay")}` : esc(e.item || "Purchase");
  const hrs = e.hours ? `<span>${esc(+e.hours)} hrs × ${money2(num(e.rate))}</span>·` : "";
  return `<div class="tx"><div class="tx-item">${title}</div><div class="tx-amt num">${money2(num(e.amount))}</div>
    <div class="tx-meta"><span class="pill neutral">${esc(catName(e.category_id))}</span>${e.processed ? `<span class="pill good">In payroll</span>` : ""}${hrs}${inStore ? "" : `<span>${esc(storeName(e.store_id))}</span>·`}<span>${esc(d)}</span>${e.vendor ? `·<span>${esc(e.vendor)}</span>` : ""}·<span>${esc(nameOf(e.created_by))}</span></div>
    ${canDel ? `<button class="link" data-del="spend" data-id="${esc(e.id)}">Remove</button>` : ""}</div>`;
}
function moveRow(m) {
  const canDel = isAdmin() || m.created_by === S.me.id;
  return `<div class="tx"><div class="tx-item">Moved ${esc(catName(m.category_id))} budget</div><div class="tx-amt move num">${money2(num(m.amount))}</div>
    <div class="tx-meta"><span class="pill acc">Reallocation</span><span>${esc(storeName(m.from_store))} → ${esc(storeName(m.to_store))}</span>·<span>${esc(nameOf(m.created_by))}</span>${m.note ? `·<span>${esc(m.note)}</span>` : ""}</div>
    ${canDel ? `<button class="link" data-del="moves" data-id="${esc(m.id)}">Undo</button>` : ""}</div>`;
}

function vMarket() {
  const stores = S.stores;
  if (!stores.length) return `<div class="card"><h2>No stores yet</h2><p class="hint">Add your shops and their monthly budgets to see the market snapshot.</p>${isAdmin() ? `<button class="btn" data-tab="stores">Add stores</button>` : ""}</div>`;
  let body;
  if (S.group === "manager") {
    const groups = {};
    stores.forEach((s) => { (groups[s.manager_id || ""] = groups[s.manager_id || ""] || []).push(s); });
    const keys = Object.keys(groups).sort((a, b) => (!a) - (!b) || nameOf(a).localeCompare(nameOf(b)));
    body = keys.map((k) => {
      const g = groups[k], fc = filterCats(), b = g.reduce((a, s) => a + budgetOf(s, fc), 0), sp = spentOf(g.map((s) => s.id), fc), st = status(sp, b, pace().pct);
      return `<div class="group-head"><b>${esc(nameOf(k || null))}</b><span class="num" style="font-size:13px">${money(sp)} / ${money(b)} <span class="pill ${st}">${STXT[st]}</span></span></div>${g.sort((a, b) => rank(b) - rank(a)).map((s) => storeRow(s, false)).join("")}`;
    }).join("");
  } else body = [...stores].sort((a, b) => a.name.localeCompare(b.name)).map((s) => storeRow(s, true)).join("");
  return `${heroBlock(stores, (CFG.MARKET || "Market") + " · left to spend")}${catChips()}${S.cat === "all" ? catCards(stores) : ""}${alertsBlock(stores)}
  <section class="sec"><div class="sec-head"><h2>Stores</h2>
    <div class="seg" role="radiogroup" aria-label="Group stores"><input type="radio" name="grp" id="g-m" value="manager" ${S.group === "manager" ? "checked" : ""}><label for="g-m">By manager</label><input type="radio" name="grp" id="g-a" value="all" ${S.group === "all" ? "checked" : ""}><label for="g-a">All stores</label></div></div>
    <div class="list">${body}</div></section>
  ${isAdmin() ? `<div class="btn-row"><button class="btn ghost" data-act="move">Move money between stores</button></div>` : ""}
  ${recentBlock(stores)}`;
}
function vHome() {
  const stores = visibleStores();
  if (!stores.length) return `<div class="card"><h2>No stores assigned yet</h2><p class="hint">Once your stores are assigned to you, their budgets show up here. You can still log purchases for any store.</p><button class="btn" data-tab="log">Log a purchase</button></div>`;
  return `${heroBlock(stores, `Your ${stores.length} store${stores.length > 1 ? "s" : ""} · left to spend`)}${catChips()}${S.cat === "all" ? catCards(stores) : ""}${alertsBlock(stores)}
  <section class="sec"><div class="sec-head"><h2>Your stores</h2>${canMove() && stores.length > 1 ? `<button class="btn ghost sm" data-act="move">Move money</button>` : ""}</div>
  <div class="list">${[...stores].sort((a, b) => rank(b) - rank(a)).map((s) => storeRow(s, false)).join("")}</div></section>${recentBlock(stores)}`;
}
function vLog() {
  if (!S.stores.length) return `<div class="card"><h2>Log a purchase</h2><p class="hint">No stores have been set up yet.</p></div>`;
  if (!purchaseCats().length) return `<div class="card"><h2>Log a purchase</h2><p class="hint">No purchase categories yet. Employee pay is logged on the Pay tab.</p></div>`;
  const last = ls.get("tsb-store"), lastCat = ls.get("tsb-cat");
  const mine = new Set(visibleStores().map((s) => s.id));
  const opt = (s) => `<option value="${esc(s.id)}" ${s.id === last ? "selected" : ""}>${esc(s.name)}</option>`;
  const yours = S.stores.filter((s) => mine.has(s.id)), others = S.stores.filter((s) => !mine.has(s.id));
  const catOk = purchaseCats().some((c) => c.id === lastCat);
  return `<form class="card" id="logForm" novalidate>
    <h2>Log a purchase</h2>
    <div class="field"><label for="f-store">Store</label><select id="f-store">
      ${yours.length && !seesAll() ? `<optgroup label="Your stores">${yours.map(opt).join("")}</optgroup><optgroup label="Other stores">${others.map(opt).join("")}</optgroup>` : S.stores.map(opt).join("")}
    </select></div>
    <div class="field"><span class="flabel">Category</span><div class="seg">${purchaseCats().map((c, i) => `<input type="radio" name="cat" id="c-${esc(c.id)}" value="${esc(c.id)}" ${(catOk ? c.id === lastCat : i === 0) ? "checked" : ""}><label for="c-${esc(c.id)}">${esc(c.name)}</label>`).join("")}</div></div>
    <div class="field"><label for="f-item">What it was for</label><input id="f-item" maxlength="120" placeholder="e.g. Microfiber towels, 300 ct"></div>
    <div class="grid2">
      <div class="field"><label for="f-amt">Amount ($)</label><input id="f-amt" inputmode="decimal" placeholder="0.00"></div>
      <div class="field"><label for="f-date">Date</label><input id="f-date" type="date" value="${todayISO}"></div>
    </div>
    <div class="field"><label for="f-vendor">Vendor or note <span class="hint">(optional)</span></label><input id="f-vendor" maxlength="80"></div>
    <button class="btn" type="submit" id="f-save">Save purchase</button>
    <div class="msg" id="f-msg" role="status"></div>
  </form>`;
}
function vStores() {
  const totals = {};
  activeCats().forEach((c) => { totals[c.id] = S.stores.reduce((a, s) => a + num((S.budgets[s.id] || {})[c.id]), 0); });
  const grand = Object.values(totals).reduce((a, b) => a + b, 0);
  const archived = S.cats.filter((c) => c.archived);
  return `<section class="card"><div class="sec-head"><h2>Categories</h2><span class="hint num">${money(grand)} / month across all stores</span></div>
    <div class="list">${activeCats().map((c) => `<div class="row"><div><div class="row-name">${esc(c.name)}</div><div class="row-meta num">${money(totals[c.id])} / month total · <button class="link" data-act="toggle-pay-cat" data-id="${esc(c.id)}">${c.pays_people ? "Paid to employees (Pay tab)" : "Purchases (Log tab)"}</button></div></div>
      <div class="btn-row" style="flex-wrap:nowrap"><button class="btn ghost sm" data-act="rename-cat" data-id="${esc(c.id)}">Rename</button><button class="btn danger sm" data-act="archive-cat" data-id="${esc(c.id)}">Remove</button></div></div>`).join("") || `<div class="empty">No categories.</div>`}</div>
    <form id="catForm" class="btn-row" novalidate><input id="cat-new" maxlength="30" placeholder="New category name" style="flex:2;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg)"><button class="btn" type="submit">Add</button></form>
    ${archived.length ? `<div class="hint">Removed: ${archived.map((c) => `${esc(c.name)} <button class="link" data-act="restore-cat" data-id="${esc(c.id)}">restore</button>`).join(" · ")}. Removed categories drop out of every budget and total; past purchases stay in history.</div>` : `<div class="hint">Removing a category drops it from every budget and total right away. You can restore it.</div>`}
    <div class="msg" id="cat-msg" role="status"></div>
  </section>
  <section class="sec"><div class="sec-head"><h2>Stores &amp; monthly budgets</h2><button class="btn sm" data-act="edit-store" data-id="new">Add store</button></div>
    <div class="list">${S.stores.length ? [...S.stores].sort((a, b) => a.name.localeCompare(b.name)).map((s) => {
      const base = activeCats().reduce((a, c) => a + num((S.budgets[s.id] || {})[c.id]), 0);
      return `<div class="row"><div><div class="row-name">${esc(s.name)}</div><div class="row-meta">${esc(nameOf(s.manager_id))} · <span class="num">${money(base)}</span>/mo</div></div>
      <button class="btn ghost sm" data-act="edit-store" data-id="${esc(s.id)}">Edit</button></div>`; }).join("") : `<div class="empty">No stores yet. Add your first store.</div>`}</div>
  </section>`;
}
function vPeople() {
  const ids = Object.keys(S.people).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  return `<section class="sec"><div class="sec-head"><h2>Team</h2><button class="btn sm" data-act="add-person">Add person</button></div>
    <div class="list">${ids.map((uid) => {
      const p = S.people[uid], n = S.stores.filter((s) => s.manager_id === uid).length;
      return `<button class="row" data-act="edit-person" data-id="${esc(uid)}"><div style="min-width:0"><div class="row-name">${esc(p.full_name || p.email)}${uid === S.me.id ? " (you)" : ""}</div><div class="row-meta">${esc(ROLE[p.role] || p.role)} · ${n} store${n === 1 ? "" : "s"}${p.can_move ? " · can move money" : ""} · ${esc(p.email || "")}</div></div>
      <span class="pill ${p.active ? "good" : "bad"}">${p.active ? "Active" : "Locked"}</span></button>`;
    }).join("")}</div></section>
  <section class="card"><h3>How logins work</h3><p class="hint" style="margin:0">Add a person with their email and a temporary password, then text it to them. They can change it from their name at the top of the screen. Locking someone signs them out of the app and blocks new sign-ins right away.</p></section>`;
}

/* ---------- 4b. Pay screen (Extra Pay / SPIFF, big buttons, hours → dollars) ---------- */
function payPool() { return seesAll() ? S.stores : visibleStores(); }
function payCalc() {
  const P = S.pay, own = payPool().some((s) => s.id === P.storeId);
  const emp = own ? S.employees.find((e) => e.id === P.empId && e.active) : null;
  const name = own ? (emp ? empName(emp) : "") : (P.other.first.trim() && /^[A-Za-z]$/.test(P.other.init.trim()) ? `${P.other.first.trim()} ${P.other.init.trim().toUpperCase()}.` : "");
  const rate = round2(own ? num(emp && emp.rate) : num(P.other.rate));
  const q = round2(num(P.qty));
  const amt = P.mode === "hours" ? round2(q * rate) : q;
  let why = "";
  if (!name) why = own ? "Pick who it's for" : "Enter first name and last initial";
  else if (!(q > 0)) why = P.mode === "hours" ? "Enter hours" : "Enter an amount";
  else if (P.mode === "hours" && !(rate > 0)) why = "Set their rate first";
  return { own, emp, name, rate, q, amt, ok: !why, why };
}
function vPay() {
  const cats = payCats(), P = S.pay, pool = payPool();
  if (!S.stores.length) return `<div class="card"><h2>Pay</h2><p class="hint">No stores have been set up yet.</p></div>`;
  if (!cats.length) return `<div class="card"><h2>Pay</h2><p class="hint">No pay categories. ${isAdmin() ? "In Stores → Categories, set Extra Pay to “Paid to employees”." : "Ask your admin to set one up."}</p></div>`;
  const viewTog = isAdmin() ? `<div class="toggle2" role="group" aria-label="Pay view"><button type="button" data-pay="view" data-v="log" aria-pressed="${S.payView === "log"}">Log pay</button><button type="button" data-pay="view" data-v="queue" aria-pressed="${S.payView === "queue"}">To enter${S.queue.length ? " · " + S.queue.length : ""}</button></div>` : "";
  if (isAdmin() && S.payView === "queue") return `<div class="pay">${viewTog}${vQueue()}</div>`;
  if (!S.stores.some((s) => s.id === P.storeId)) { const last = ls.get("tsb-pay-store"); P.storeId = (pool.find((s) => s.id === last) || pool[0] || S.stores[0]).id; }
  if (!cats.some((c) => c.id === P.catId)) P.catId = cats[0].id;
  const c = payCalc(), others = S.stores.filter((s) => !pool.some((x) => x.id === s.id));
  const emps = S.employees.filter((e) => e.store_id === P.storeId && e.active).sort((a, b) => a.first_name.localeCompare(b.first_name));
  const quick = P.mode === "hours" ? QUICK_HOURS : QUICK_DOLLARS;
  const recent = S.spend.filter((e) => e.store_id === P.storeId && cats.some((k) => k.id === e.category_id))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8);
  const pb = cats.length > 1 ? `<div class="toggle2" role="group" aria-label="Type">${cats.slice(0, 2).map((k) => `<button type="button" data-pay="cat" data-v="${esc(k.id)}" aria-pressed="${k.id === P.catId}">${esc(k.name)}</button>`).join("")}</div>${cats.length > 2 ? `<div class="chipsw" style="margin-top:8px">${cats.slice(2).map((k) => `<button class="chip lg" data-pay="cat" data-v="${esc(k.id)}" aria-pressed="${k.id === P.catId}">${esc(k.name)}</button>`).join("")}</div>` : ""}` : "";
  return `<div class="pay">
    ${viewTog}${pb}
    <section><div class="step-label"><b>Store</b></div>
      <div class="chipsw">${pool.map((s) => `<button class="chip lg" data-pay="store" data-v="${esc(s.id)}" aria-pressed="${s.id === P.storeId}">${esc(s.name)}</button>`).join("")}</div>
      ${others.length ? `<select id="pay-other-store" style="margin-top:8px;width:100%;min-height:46px;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)"><option value="">${pool.length ? "Another store…" : "Pick a store…"}</option>${others.map((s) => `<option value="${esc(s.id)}" ${s.id === P.storeId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>` : ""}
    </section>
    <section><div class="step-label"><b>Who</b>${c.own && canEditEmps(P.storeId) ? `<button class="link" data-act="emps" data-id="${esc(P.storeId)}">Manage employees</button>` : ""}</div>
      ${c.own ? `<div class="tiles">${emps.map((e) => `<button class="tile" data-pay="emp" data-v="${esc(e.id)}" aria-pressed="${e.id === P.empId}"><b>${esc(empName(e))}</b><span>${num(e.rate) > 0 ? money2(e.rate) + "/hr" : "No rate set"}</span></button>`).join("")}
        ${canEditEmps(P.storeId) ? `<button class="tile add" data-act="emp-add">+ Add employee</button>` : ""}</div>
        ${!emps.length && !canEditEmps(P.storeId) ? `<p class="hint">No employees listed for this store yet.</p>` : ""}`
      : `<div class="other-emp"><div class="field"><label for="o-first">First name</label><input id="o-first" maxlength="30" value="${esc(P.other.first)}" autocomplete="off"></div>
         <div class="field"><label for="o-init">Last initial</label><input id="o-init" maxlength="1" value="${esc(P.other.init)}" autocomplete="off" style="text-transform:uppercase;text-align:center"></div></div>
         <p class="hint" style="margin:6px 0 0">This isn't your store, so its employee list is hidden. Type the name instead.</p>`}
    </section>
    <section><div class="step-label"><b>How much</b></div>
      <div class="toggle2" role="group" aria-label="Enter in"><button type="button" data-pay="mode" data-v="hours" aria-pressed="${P.mode === "hours"}">Hours</button><button type="button" data-pay="mode" data-v="dollars" aria-pressed="${P.mode === "dollars"}">Dollars</button></div>
      <div class="qgrid" style="margin-top:10px">${quick.map((v) => `<button class="qbtn" data-pay="q" data-v="${v}" aria-pressed="${num(P.qty) === v}">${P.mode === "hours" ? v : "$" + v}</button>`).join("")}</div>
      <div class="amount"><button class="stepbtn" type="button" data-pay="step" data-v="-1" aria-label="Less">−</button>
        <input id="pay-qty" inputmode="decimal" value="${esc(P.qty)}" placeholder="${P.mode === "hours" ? "0 hrs" : "$0"}" aria-label="${P.mode === "hours" ? "Hours" : "Dollars"}" autocomplete="off">
        <button class="stepbtn" type="button" data-pay="step" data-v="1" aria-label="More">+</button></div>
      ${P.mode === "hours" ? (c.own
        ? (c.emp ? `<div class="rate-line ${c.rate > 0 ? "" : "warn"}"><span>${esc(empName(c.emp))}'s rate: <b class="num">${c.rate > 0 ? money2(c.rate) + "/hr" : "not set"}</b></span>${canEditEmps(P.storeId) ? `<button class="btn ghost sm" data-act="emp-edit" data-id="${esc(c.emp.id)}">${c.rate > 0 ? "Change" : "Set rate"}</button>` : ""}</div>` : "")
        : `<div class="field" style="margin-top:10px"><label for="o-rate">Their rate ($ per hour)</label><input id="o-rate" inputmode="decimal" value="${esc(P.other.rate)}" placeholder="0.00"></div>`) : ""}
    </section>
    <section><div class="step-label"><b>Reason</b></div>
      <div class="chipsw">${PAY_REASONS.map((r) => `<button class="chip lg" data-pay="reason" data-v="${esc(r)}" aria-pressed="${P.reason === r}">${esc(r)}</button>`).join("")}</div>
      <div class="grid2" style="margin-top:10px"><div class="field"><label for="pay-note">Note <span class="hint">(optional)</span></label><input id="pay-note" maxlength="80" value="${esc(P.note)}" placeholder="e.g. RO 4471"></div>
      <div class="field"><label for="pay-date">Date</label><input id="pay-date" type="date" value="${esc(P.date)}"></div></div>
    </section>
    <div class="savebar"><div class="total" id="pay-total">${payTotalHTML(c)}</div>
      <button class="btn bigbtn" id="pay-save" data-pay="save" ${c.ok ? "" : "disabled"}>${payBtnText(c)}</button>
      <div class="msg" id="pay-msg" role="status" style="text-align:center"></div></div>
    <section class="sec"><div class="sec-head"><h2>Recent at ${esc(storeName(P.storeId))}</h2><span class="hint">${esc(monthLabel())}</span></div>
      <div class="list">${recent.length ? recent.map((e) => txRow(e, true)).join("") : `<div class="empty">No pay logged here this month.</div>`}</div></section>
  </div>`;
}
/* Payroll list (admin): pay entries not yet entered in payroll, from any month. */
const fmtDay = (d) => (d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
function payMeta(e) {
  return `<span class="pill neutral">${esc(catName(e.category_id))}</span>${e.hours ? `<span class="num">${esc(+e.hours)} hrs × ${money2(num(e.rate))}</span>·` : ""}<span>${esc(storeName(e.store_id))}</span>·<span>${esc(fmtDay(e.spent_on))}</span>${e.vendor ? `·<span>${esc(e.vendor)}</span>` : ""}·<span>${esc(nameOf(e.created_by))}</span>`;
}
function vQueue() {
  if (S.queueErr) return `<div class="card"><h2>Payroll list unavailable</h2><p class="hint">${esc(S.queueErr)}</p></div>`;
  const q = S.queue, total = q.reduce((a, e) => a + num(e.amount), 0);
  return `<section class="card"><div class="sec-head"><div><div class="label">To enter in payroll</div><div class="hero-big num" style="font-size:40px">${money2(total)}</div><div class="hint">${q.length} entr${q.length === 1 ? "y" : "ies"} · all months</div></div>
      ${q.length > 1 ? `<button class="btn ghost sm" data-act="pr-all">Mark all ${q.length} entered</button>` : ""}</div>
      <p class="hint" style="margin:0">Tap <b>Entered</b> after you key it into payroll. It moves to history below; nothing is deleted.</p></section>
    <section class="sec"><div class="list">${q.length ? q.map((e) => `<div class="tx"><div class="tx-item">${esc(e.employee_name || "Employee")} · ${esc(e.item || "Pay")}</div><div class="tx-amt num">${money2(num(e.amount))}</div>
      <div class="tx-meta">${payMeta(e)}</div><button class="btn sm" data-act="pr-mark" data-id="${esc(e.id)}">Entered</button></div>`).join("")
      : `<div class="empty">All caught up. Nothing waiting to go into payroll.</div>`}</div></section>
    <section class="sec"><div class="sec-head"><h2>Recently entered</h2><span class="hint">last ${S.entered.length}</span></div>
      <div class="list">${S.entered.length ? S.entered.map((e) => `<div class="tx"><div class="tx-item">${esc(e.employee_name || "Employee")} · ${esc(e.item || "Pay")}</div><div class="tx-amt num">${money2(num(e.amount))}</div>
      <div class="tx-meta">${payMeta(e)}·<span class="pill good">Entered ${esc(fmtDay(e.processed_at))}${e.processed_by ? " · " + esc(nameOf(e.processed_by)) : ""}</span></div><button class="link" data-act="pr-undo" data-id="${esc(e.id)}">Undo</button></div>`).join("")
      : `<div class="empty">Nothing marked yet.</div>`}</div></section>`;
}
async function markEntered(ids, on) {
  const row = on ? { processed: true, processed_at: new Date().toISOString(), processed_by: S.me.id } : { processed: false, processed_at: null, processed_by: null };
  try { await must(sb.from("spend").update(row).in("id", ids)); await loadAll(); flash(on ? `Marked ${ids.length} entered.` : "Moved back to the list."); }
  catch (err) { flash(errText(err)); }
}
async function loadQueue() {
  S.queueErr = "";
  const ids = S.cats.filter((c) => c.pays_people).map((c) => c.id);
  if (!isAdmin() || !ids.length) { S.queue = []; S.entered = []; return; }
  try {
    [S.queue, S.entered] = await Promise.all([
      must(sb.from("spend").select("*").in("category_id", ids).eq("processed", false).order("spent_on").order("created_at")),
      must(sb.from("spend").select("*").in("category_id", ids).eq("processed", true).order("processed_at", { ascending: false }).limit(40)),
    ]);
  } catch (err) {
    S.queue = []; S.entered = [];
    S.queueErr = /processed/i.test(err.message || "") ? "The database update hasn't been run yet (migration 002)." : errText(err);
  }
}
function payTotalHTML(c) {
  if (S.pay.mode === "hours" && c.q > 0 && c.rate > 0) return `${money2(c.amt)}<small>${c.q} hrs × ${money2(c.rate)}/hr</small>`;
  return c.q > 0 && S.pay.mode === "dollars" ? `${money2(c.amt)}<small>${esc(c.name || "")}</small>` : `$0.00<small>&nbsp;</small>`;
}
const payBtnText = (c) => (c.ok ? `Add ${money2(c.amt)} for ${esc(c.name)}` : esc(c.why));
function payRefresh() {
  const c = payCalc(), b = $("#pay-save");
  if (!b) return;
  $("#pay-total").innerHTML = payTotalHTML(c);
  b.disabled = !c.ok; b.innerHTML = payBtnText(c);
  document.querySelectorAll('[data-pay="q"]').forEach((x) => x.setAttribute("aria-pressed", String(num(S.pay.qty) === num(x.dataset.v))));
}
async function paySave() {
  const P = S.pay, c = payCalc(), msg = $("#pay-msg"), b = $("#pay-save");
  if (!c.ok) return;
  b.disabled = true;
  const hours = P.mode === "hours";
  try {
    await must(sb.from("spend").insert({
      store_id: P.storeId, category_id: P.catId, item: P.reason || "Extra pay", vendor: P.note.trim() || null,
      amount: c.amt, spent_on: P.date || todayISO, employee_id: c.emp ? c.emp.id : null, employee_name: c.name,
      hours: hours ? c.q : null, rate: hours ? c.rate : null,
    }));
    ls.set("tsb-pay-store", P.storeId);
    const done = `Added ${money2(c.amt)} for ${c.name}.`;
    P.qty = ""; P.note = ""; P.empId = null; P.other = { first: "", init: "", rate: P.other.rate };
    await loadAll();
    say($("#pay-msg"), done);
  } catch (err) { say(msg, errText(err), 1); b.disabled = false; }
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-pay]"); if (!t) return;
  const P = S.pay, k = t.dataset.pay, v = t.dataset.v;
  if (k === "save") return paySave();
  if (k === "q") { P.qty = String(v); return payRefresh(); }
  if (k === "step") {
    const stepSize = P.mode === "hours" ? 0.5 : 5;
    P.qty = String(Math.max(0, round2(num(P.qty) + stepSize * Number(v))) || "");
    $("#pay-qty").value = P.qty; return payRefresh();
  }
  if (k === "store") { P.storeId = v; P.empId = null; }
  if (k === "cat") P.catId = v;
  if (k === "emp") P.empId = P.empId === v ? null : v;
  if (k === "mode") { if (P.mode !== v) P.qty = ""; P.mode = v; }
  if (k === "reason") P.reason = v;
  if (k === "view") { S.payView = v; window.scrollTo(0, 0); }
  render();
});
document.addEventListener("input", (e) => {
  const P = S.pay, id = e.target.id;
  if (id === "pay-qty") P.qty = e.target.value.replace(/[^0-9.]/g, "");
  else if (id === "pay-note") P.note = e.target.value;
  else if (id === "pay-date") P.date = e.target.value;
  else if (id === "o-first") P.other.first = e.target.value.replace(/[^A-Za-z' -]/g, "");
  else if (id === "o-init") { P.other.init = e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 1); e.target.value = P.other.init; }
  else if (id === "o-rate") P.other.rate = e.target.value;
  else return;
  payRefresh();
});
document.addEventListener("change", (e) => {
  if (e.target.id === "pay-other-store" && e.target.value) { S.pay.storeId = e.target.value; S.pay.empId = null; render(); }
});

function empListSheet(storeId) {
  const s = S.stores.find((x) => x.id === storeId); if (!s) return;
  const list = S.employees.filter((e) => e.store_id === storeId).sort((a, b) => (b.active - a.active) || a.first_name.localeCompare(b.first_name));
  openSheet(`${head("Employees", esc(s.name))}
    <div class="list">${list.length ? list.map((e) => `<button class="row" data-act="emp-edit" data-id="${esc(e.id)}"><div><div class="row-name">${esc(empName(e))}</div><div class="row-meta num">${num(e.rate) > 0 ? money2(e.rate) + " per hour" : "No rate set"}</div></div><span class="pill ${e.active ? "good" : "neutral"}">${e.active ? "Active" : "Removed"}</span></button>`).join("") : `<div class="empty">No employees yet.</div>`}</div>
    <button class="btn bigbtn" data-act="emp-add" data-store2="${esc(storeId)}">+ Add employee</button>`, "form");
}
function empSheet(id, storeId) {
  const e = id === "new" ? { first_name: "", last_initial: "", rate: "", store_id: storeId, active: true } : S.employees.find((x) => x.id === id);
  if (!e) return;
  const stores = S.stores.filter((s) => canEditEmps(s.id));
  openSheet(`${head(id === "new" ? "Add employee" : esc(empName(e)), "First name + last initial only")}
    <form class="card" id="empForm" novalidate>
      <div class="other-emp"><div class="field"><label for="e-first">First name</label><input id="e-first" maxlength="30" value="${esc(e.first_name)}" autocomplete="off"></div>
      <div class="field"><label for="e-init">Last initial</label><input id="e-init" maxlength="1" value="${esc(e.last_initial)}" autocomplete="off" style="text-transform:uppercase;text-align:center"></div></div>
      <div class="field"><label for="e-rate">Hourly or flat rate ($ per hour)</label><input id="e-rate" inputmode="decimal" value="${esc(e.rate)}" placeholder="e.g. 18.00" style="font-size:24px;min-height:56px"><span class="hint">Used to turn hours into dollars on the Pay screen.</span></div>
      <div class="field"><label for="e-store">Store</label><select id="e-store">${stores.map((s) => `<option value="${esc(s.id)}" ${s.id === e.store_id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
      ${id !== "new" ? `<label class="toggle"><input type="checkbox" id="e-active" ${e.active ? "checked" : ""}> Active (shows on the Pay screen)</label>` : ""}
      <button class="btn bigbtn" type="submit">${id === "new" ? "Add employee" : "Save"}</button>
      <div class="msg" id="e-msg" role="status"></div>
    </form>`, "form");
  const init = $("#e-init");
  init.addEventListener("input", () => { init.value = init.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 1); });
  $("#empForm").addEventListener("submit", async (ev) => {
    ev.preventDefault(); const m = $("#e-msg");
    const row = { first_name: $("#e-first").value.trim().replace(/\s+/g, " "), last_initial: init.value.trim().toUpperCase(), rate: round2(Math.max(0, num($("#e-rate").value))), store_id: $("#e-store").value };
    if (!row.first_name) return say(m, "Enter their first name.", 1);
    if (row.first_name.includes(" ")) return say(m, "First name only. Put the last initial in the next box.", 1);
    if (!/^[A-Z]$/.test(row.last_initial)) return say(m, "Enter one letter for the last initial.", 1);
    if ($("#e-active")) row.active = $("#e-active").checked;
    try {
      if (id === "new") { const r = await must(sb.from("employees").insert(row).select().single()); S.pay.empId = r.id; S.pay.storeId = r.store_id; }
      else await must(sb.from("employees").update(row).eq("id", id));
      closeSheet(); await loadAll(); flash(id === "new" ? `${row.first_name} ${row.last_initial}. added.` : "Saved.");
    } catch (err) { say(m, errText(err), 1); }
  });
}

/* ---------- 5. Sheets ---------- */
function openSheet(html, kind, id) {
  S.sheet = { kind, id };
  $("#sheetRoot").innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  $("#scrim").addEventListener("click", (e) => { if (e.target.id === "scrim" || e.target.closest("[data-close]")) closeSheet(); });
}
function closeSheet() { $("#sheetRoot").innerHTML = ""; S.sheet = null; }
const head = (t, sub) => `<div class="sheet-head"><div>${sub ? `<div class="label">${sub}</div>` : ""}<h2>${t}</h2></div><button class="x" type="button" data-close aria-label="Close">×</button></div>`;
const say = (el, t, err) => { if (!el) return; el.className = "msg " + (err ? "err" : "ok"); el.textContent = t; };

function storeSheet(id) {
  const s = S.stores.find((x) => x.id === id); if (!s) return closeSheet();
  const p = pace();
  const mine = S.spend.filter((e) => e.store_id === id).sort((a, b) => String(b.spent_on).localeCompare(String(a.spent_on)) || String(b.created_at).localeCompare(String(a.created_at)));
  const mv = S.moves.filter((m) => m.from_store === id || m.to_store === id);
  const canMv = canMove() && (isAdmin() || visibleStores().length > 1);
  openSheet(`${head(esc(s.name), esc(monthLabel()) + (seesAll() ? " · " + esc(nameOf(s.manager_id)) : ""))}
    <div class="list">${activeCats().map((c) => { const b = budgetOf(s, [c.id]), sp = spentOf([id], [c.id]), k = status(sp, b, p.pct);
      return `<div class="row"><div><div class="row-name">${esc(c.name)}</div><div class="row-meta num">${money(sp)} of ${money(b)}</div></div><div class="right"><div class="row-amt num">${money(b - sp)} left</div><span class="pill ${k}">${STXT[k]}</span></div>${bar(sp, b, p.pct, k)}</div>`; }).join("")}</div>
    <div class="btn-row">${canMv ? `<button class="btn" data-act="move" data-id="${esc(id)}">Move money</button>` : ""}${isAdmin() ? `<button class="btn ghost" data-act="edit-store" data-id="${esc(id)}">Edit budgets</button>` : ""}</div>
    ${mv.length ? `<div class="sec"><h3>Reallocations</h3><div class="list">${mv.map(moveRow).join("")}</div></div>` : ""}
    <div class="sec"><div class="sec-head"><h3>Purchases</h3><span class="hint">${mine.length}</span></div>
    <div class="list">${mine.length ? mine.map((e) => txRow(e, true)).join("") : `<div class="empty">No purchases logged this month.</div>`}</div></div>`, "store", id);
}
function editStoreSheet(id) {
  const s = id === "new" ? { name: "", manager_id: "" } : S.stores.find((x) => x.id === id); if (!s) return;
  const base = S.budgets[s.id] || {};
  const mgrs = Object.values(S.people).filter((p) => p.role === "manager" || p.id === s.manager_id).sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
  openSheet(`${head(id === "new" ? "Add store" : "Edit " + esc(s.name), "Monthly budget")}
    <form class="card" id="storeForm" novalidate>
      <div class="field"><label for="s-name">Store name</label><input id="s-name" maxlength="60" value="${esc(s.name)}" placeholder="e.g. Sandy"></div>
      <div class="field"><label for="s-mgr">Area manager</label><select id="s-mgr"><option value="">Unassigned</option>${mgrs.map((p) => `<option value="${esc(p.id)}" ${p.id === s.manager_id ? "selected" : ""}>${esc(p.full_name || p.email)}</option>`).join("")}</select></div>
      <div class="field"><span class="flabel">Monthly budget by category ($)</span><div class="budget-grid">${activeCats().map((c) => `<div class="field"><label for="b-${esc(c.id)}" class="hint">${esc(c.name)}</label><input id="b-${esc(c.id)}" data-bcat="${esc(c.id)}" inputmode="decimal" value="${esc(base[c.id] ?? "")}" placeholder="0"></div>`).join("")}</div></div>
      <div class="hint num" id="s-total"></div>
      <div class="btn-row"><button class="btn" type="submit">${id === "new" ? "Add store" : "Save changes"}</button>${id !== "new" ? `<button class="btn danger" type="button" id="s-del">Remove store</button>` : ""}</div>
      <div class="msg" id="s-msg" role="status"></div>
    </form>`, "form");
  const f = $("#storeForm");
  const tot = () => { let t = 0; f.querySelectorAll("[data-bcat]").forEach((i) => (t += num(i.value))); $("#s-total").textContent = "Total: " + money(t) + " / month"; };
  tot(); f.addEventListener("input", tot);
  f.addEventListener("submit", async (e) => {
    e.preventDefault(); const msg = $("#s-msg"), name = $("#s-name").value.trim();
    if (!name) return say(msg, "Enter a store name.", 1);
    try {
      const row = { name, manager_id: $("#s-mgr").value || null };
      let storeId = id;
      if (id === "new") storeId = (await must(sb.from("stores").insert(row).select().single())).id;
      else await must(sb.from("stores").update(row).eq("id", id));
      const rows = [...f.querySelectorAll("[data-bcat]")].map((i) => ({ store_id: storeId, category_id: i.dataset.bcat, amount: Math.max(0, num(i.value)) }));
      if (rows.length) await must(sb.from("store_budgets").upsert(rows));
      closeSheet(); await loadAll();
    } catch (err) { say(msg, errText(err), 1); }
  });
  const d = $("#s-del");
  if (d) d.addEventListener("click", async () => {
    if (!d.dataset.armed) { d.dataset.armed = 1; d.textContent = "Tap again: removes store AND its purchase history"; return; }
    try { await must(sb.from("stores").delete().eq("id", id)); closeSheet(); await loadAll(); } catch (err) { say($("#s-msg"), errText(err), 1); }
  });
}
function moveSheet(fromId) {
  const pool = isAdmin() ? S.stores : visibleStores();
  if (pool.length < 2) return;
  const from = fromId && pool.find((s) => s.id === fromId) ? fromId : pool[0].id;
  const sorted = [...pool].sort((a, b) => a.name.localeCompare(b.name));
  const opts = (sel) => sorted.map((s) => `<option value="${esc(s.id)}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  const to = (sorted.find((s) => s.id !== from) || {}).id;
  openSheet(`${head("Move money", esc(monthLabel()) + " only")}
    <form class="card" id="moveForm" novalidate>
      <p class="hint" style="margin:0">Shift unused budget from a store that's under to one that's over. It only affects ${esc(monthLabel())}.</p>
      <div class="field"><label for="m-cat">Category</label><select id="m-cat">${activeCats().map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></div>
      <div class="grid2"><div class="field"><label for="m-from">From (has extra)</label><select id="m-from">${opts(from)}</select></div>
      <div class="field"><label for="m-to">To (needs it)</label><select id="m-to">${opts(to)}</select></div></div>
      <div class="hint num" id="m-info"></div>
      <div class="field"><label for="m-amt">Amount ($)</label><input id="m-amt" inputmode="decimal" placeholder="0.00"></div>
      <div class="field"><label for="m-note">Reason <span class="hint">(optional)</span></label><input id="m-note" maxlength="80" placeholder="e.g. Covering buffer replacement"></div>
      <button class="btn" type="submit">Move money</button><div class="msg" id="m-msg" role="status"></div>
    </form>`, "form");
  const f = $("#moveForm");
  const info = () => {
    const c = $("#m-cat").value, a = S.stores.find((s) => s.id === $("#m-from").value), b = S.stores.find((s) => s.id === $("#m-to").value);
    const la = a ? budgetOf(a, [c]) - spentOf([a.id], [c]) : 0, lb = b ? budgetOf(b, [c]) - spentOf([b.id], [c]) : 0;
    $("#m-info").textContent = `${a ? a.name : ""}: ${money(la)} left · ${b ? b.name : ""}: ${money(lb)} left`;
    return la;
  };
  info(); f.addEventListener("change", info);
  f.addEventListener("submit", async (e) => {
    e.preventDefault(); const msg = $("#m-msg"), amt = Math.round(num($("#m-amt").value) * 100) / 100, fr = $("#m-from").value, t = $("#m-to").value;
    if (fr === t) return say(msg, "Pick two different stores.", 1);
    if (!(amt > 0)) return say(msg, "Enter an amount greater than $0.", 1);
    const left = info(); if (amt > left && !isAdmin()) return say(msg, `That's more than ${storeName(fr)} has left (${money(left)}).`, 1);
    try {
      await must(sb.from("moves").insert({ month: monthStart(), category_id: $("#m-cat").value, from_store: fr, to_store: t, amount: amt, note: $("#m-note").value.trim() || null }));
      closeSheet(); await loadAll(); flash(`Moved ${money2(amt)} to ${storeName(t)}.`);
    } catch (err) { say(msg, errText(err), 1); }
  });
}
function addPersonSheet() {
  openSheet(`${head("Add person", "Team")}
    <form class="card" id="addForm" novalidate>
      <div class="field"><label for="a-name">Full name</label><input id="a-name" maxlength="60" autocomplete="off"></div>
      <div class="field"><label for="a-email">Email (their login)</label><input id="a-email" type="email" autocomplete="off"></div>
      <div class="field"><label for="a-pw">Temporary password</label><input id="a-pw" autocomplete="off" value="${esc(tempPassword())}"><span class="hint">At least 8 characters. Send it to them; they can change it after signing in.</span></div>
      ${roleSeg("manager")}
      <label class="toggle"><input type="checkbox" id="p-move"> Can move money between their stores</label>
      <button class="btn" type="submit">Add person</button><div class="msg" id="a-msg" role="status"></div>
    </form>`, "form");
  $("#addForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const msg = $("#a-msg");
    const body = { action: "create", full_name: $("#a-name").value.trim(), email: $("#a-email").value.trim(), password: $("#a-pw").value, role: $("#addForm").querySelector("input[name=role]:checked").value, can_move: $("#p-move").checked };
    if (!body.full_name) return say(msg, "Enter their name.", 1);
    if (!body.email.includes("@")) return say(msg, "Enter a valid email.", 1);
    if (body.password.length < 8) return say(msg, "Password must be at least 8 characters.", 1);
    try { await adminCall(body); closeSheet(); await loadAll(); flash(`${body.full_name} can now sign in with ${body.email}.`); } catch (err) { say(msg, err.message, 1); }
  });
}
function roleSeg(cur) {
  return `<div class="field"><span class="flabel">Role</span><div class="seg">${Object.entries(ROLE).map(([k, v]) => `<input type="radio" name="role" id="r-${k}" value="${k}" ${cur === k ? "checked" : ""}><label for="r-${k}">${v}</label>`).join("")}</div>
    <span class="hint">Area Managers see only their assigned stores. District sees every store, read-only. Admins can change everything.</span></div>`;
}
function personSheet(uid) {
  const p = S.people[uid]; if (!p) return;
  const self = uid === S.me.id;
  const stores = S.stores.filter((s) => s.manager_id === uid).map((s) => s.name);
  openSheet(`${head(esc(p.full_name || p.email), esc(p.email || ""))}
    <form class="card" id="personForm" novalidate>
      <div class="field"><label for="p-name">Full name</label><input id="p-name" maxlength="60" value="${esc(p.full_name)}"></div>
      ${self ? "" : roleSeg(p.role)}
      <label class="toggle"><input type="checkbox" id="p-move" ${p.can_move ? "checked" : ""}> Can move money between their stores</label>
      <div class="hint">${stores.length ? "Assigned stores: " + stores.map(esc).join(", ") : "No stores assigned. Assign stores from the Stores tab."}</div>
      <button class="btn" type="submit">Save</button><div class="msg" id="p-msg" role="status"></div>
    </form>
    <form class="card" id="pwForm" novalidate><h3>Reset password</h3>
      <div class="btn-row"><input id="p-pw" value="${esc(tempPassword())}" autocomplete="off" style="flex:2;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg)"><button class="btn" type="submit">Set password</button></div>
      <div class="msg" id="pw-msg" role="status"></div></form>
    ${self ? "" : `<div class="card"><h3>Access</h3><div class="btn-row">
      <button class="btn ${p.active ? "danger" : ""}" type="button" id="p-lock">${p.active ? "Lock out" : "Unlock"}</button>
      <button class="btn ghost" type="button" id="p-del">Remove person</button></div>
      <div class="msg" id="ac-msg" role="status"></div></div>`}`, "form");
  $("#personForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = { full_name: $("#p-name").value.trim(), can_move: $("#p-move").checked };
    if (!self) row.role = $("#personForm").querySelector("input[name=role]:checked").value;
    try { await must(sb.from("profiles").update(row).eq("id", uid)); closeSheet(); await loadAll(); flash("Saved."); } catch (err) { say($("#p-msg"), errText(err), 1); }
  });
  $("#pwForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const pw = $("#p-pw").value;
    if (pw.length < 8) return say($("#pw-msg"), "Password must be at least 8 characters.", 1);
    try { await adminCall({ action: "reset_password", user_id: uid, password: pw }); say($("#pw-msg"), `New password set: ${pw}`); } catch (err) { say($("#pw-msg"), err.message, 1); }
  });
  if (self) return;
  $("#p-lock").addEventListener("click", async () => {
    try { await adminCall({ action: "set_active", user_id: uid, active: !p.active }); closeSheet(); await loadAll(); flash(p.active ? "Locked out." : "Unlocked."); } catch (err) { say($("#ac-msg"), err.message, 1); }
  });
  const d = $("#p-del");
  d.addEventListener("click", async () => {
    if (!d.dataset.armed) { d.dataset.armed = 1; d.textContent = "Tap again to remove"; return; }
    try { await adminCall({ action: "delete", user_id: uid }); closeSheet(); await loadAll(); flash("Removed."); } catch (err) { say($("#ac-msg"), err.message, 1); }
  });
}
function accountSheet() {
  if (!S.me) return;
  openSheet(`${head(esc(S.me.full_name || S.me.email), esc(ROLE[S.me.role] || ""))}
    <form class="card" id="myPw" novalidate><h3>Change my password</h3>
      <div class="field"><label for="n1">New password</label><input id="n1" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="n2">Type it again</label><input id="n2" type="password" autocomplete="new-password"></div>
      <button class="btn" type="submit">Change password</button><div class="msg" id="my-msg" role="status"></div></form>
    <button class="btn ghost" type="button" id="signout">Sign out</button>`, "form");
  $("#myPw").addEventListener("submit", async (e) => {
    e.preventDefault(); const a = $("#n1").value, b = $("#n2").value, m = $("#my-msg");
    if (a.length < 8) return say(m, "Use at least 8 characters.", 1);
    if (a !== b) return say(m, "The two passwords don't match.", 1);
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) return say(m, error.message, 1);
    $("#n1").value = $("#n2").value = ""; say(m, "Password changed.");
  });
  $("#signout").addEventListener("click", async () => { closeSheet(); await sb.auth.signOut(); });
}
function tempPassword() {
  const w = ["Shine", "Polish", "Detail", "Gloss", "Wax", "Buff", "Coat", "Clean"];
  return w[Math.floor(Math.random() * w.length)] + "-" + (1000 + Math.floor(Math.random() * 9000)) + "!";
}

/* ---------- 6. Saving & loading data ---------- */
async function must(q) { const { data, error } = await q; if (error) throw error; return data; }
async function adminCall(body) {
  const { data, error } = await sb.functions.invoke("admin-users", { body });
  if (error) {
    let m = "Couldn't reach the admin service. Is the admin-users function deployed? (SETUP.md step 4)";
    try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (_) {}
    throw new Error(m);
  }
  return data;
}
const errText = (e) => {
  const m = (e && e.message) || "";
  if (/row-level security|permission/i.test(m)) return "You don't have permission to do that.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "No connection. Check your internet and try again.";
  return m || "Couldn't save. Try again.";
};
function flash(t) {
  const b = $("#banner"); b.hidden = false; b.style.background = "var(--good-soft)"; b.style.borderColor = "var(--good)"; b.textContent = t;
  clearTimeout(flash.t); flash.t = setTimeout(() => { b.hidden = true; b.removeAttribute("style"); }, 4000);
}
async function loadAll() {
  if (!S.me) return;
  try {
    const [cats, stores, budgets, people, spend, moves] = await Promise.all([
      must(sb.from("categories").select("*").order("sort").order("created_at")),
      must(sb.from("stores").select("*").order("name")),
      must(sb.from("store_budgets").select("*")),
      must(sb.from("profiles").select("id,email,full_name,role,can_move,active")),
      must(sb.from("spend").select("*").gte("spent_on", monthStart()).lt("spent_on", nextMonthStart())),
      must(sb.from("moves").select("*").eq("month", monthStart())),
      must(sb.from("employees").select("*").order("first_name")),
    ]).then((r) => { S.employees = r.pop(); return r; });
    S.cats = cats; S.stores = stores; S.spend = spend; S.moves = moves;
    S.budgets = {}; budgets.forEach((r) => { (S.budgets[r.store_id] = S.budgets[r.store_id] || {})[r.category_id] = num(r.amount); });
    S.people = {}; people.forEach((p) => { S.people[p.id] = p; });
    if (S.people[S.me.id]) S.me = S.people[S.me.id];
    await loadQueue();
  } catch (err) {
    const b = $("#banner"); b.hidden = false; b.textContent = "Couldn't load the latest numbers: " + errText(err);
  }
  render();
}
async function saveCats(list) {
  try { for (const op of list) await must(op); await loadAll(); } catch (err) { say($("#cat-msg"), errText(err), 1); }
}
function exportCSV() {
  const ids = new Set(visibleStores().map((s) => s.id)), q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Date", "Store", "Area manager", "Category", "Employee", "Item / reason", "Vendor/note", "Hours", "Rate", "Amount", "Logged by", "Entered in payroll"]];
  S.spend.filter((e) => ids.has(e.store_id)).sort((a, b) => String(a.spent_on).localeCompare(String(b.spent_on))).forEach((e) => {
    const s = S.stores.find((x) => x.id === e.store_id) || {};
    rows.push([e.spent_on, storeName(e.store_id), nameOf(s.manager_id), catName(e.category_id), e.employee_name || "", e.item, e.vendor, e.hours ?? "", e.rate ?? "", num(e.amount).toFixed(2), nameOf(e.created_by), e.processed ? String(e.processed_at || "").slice(0, 10) || "yes" : ""]);
  });
  const blob = new Blob([rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `budget-spend-${monthStart().slice(0, 7)}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ---------- 7. Shell ---------- */
const ICON = {
  market: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/>', home: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/>',
  log: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', stores: '<path d="M3 10l2-5h14l2 5"/><path d="M4 10v9h16v-9"/><path d="M9 19v-5h6v5"/>',
  pay: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 19a6 6 0 0 0-2.5-4.9"/>',
};
const TABS = {
  admin: [["market", "Market"], ["pay", "Pay"], ["log", "Purchases"], ["stores", "Stores"], ["people", "People"]],
  district: [["market", "Market"], ["pay", "Pay"], ["log", "Purchases"]],
  manager: [["home", "My stores"], ["pay", "Pay"], ["log", "Purchases"]],
};
const VIEWS = { market: vMarket, home: vHome, pay: vPay, log: vLog, stores: vStores, people: vPeople };

function gate() {
  if (S.mode === "loading") return `<div class="gate"><div class="spin" aria-label="Loading"></div></div>`;
  if (S.mode === "login") return `<div class="gate"><form class="card login" id="loginForm" novalidate>
      <h2>Sign in</h2>
      <div class="field"><label for="l-email">Email</label><input id="l-email" type="email" autocomplete="username"></div>
      <div class="field"><label for="l-pw">Password</label><input id="l-pw" type="password" autocomplete="current-password"></div>
      <button class="btn" type="submit" id="l-go">Sign in</button>
      <div class="msg" id="l-msg" role="status"></div>
      <p class="hint" style="margin:0">Forgot your password? Ask your admin to reset it.</p></form></div>`;
  if (S.mode === "locked") return `<div class="gate"><h2>Access paused</h2><p>Your access has been turned off or hasn't been set up yet. Reach out to your Market President if you think this is a mistake.</p><button class="btn ghost" data-act="signout">Sign out</button></div>`;
  return null;
}
function render() {
  $("#monthLabel").textContent = S.month.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  const g = gate(), tabs = TABS[S.mode];
  $("#who").textContent = S.me && !g ? `${S.me.full_name || S.me.email} · ${ROLE[S.me.role] || ""}` : S.mode === "login" ? (CFG.MARKET || "") + " market" : "";
  $("#who").disabled = !!g;
  $(".month").hidden = !!g;
  const vw = $("#view");
  if (g) { vw.innerHTML = g; vw.dataset.tab = ""; $("#nav").hidden = true; bindGate(); return; }
  if (!tabs.some((t) => t[0] === S.tab)) S.tab = tabs[0][0];
  const typing = vw.dataset.tab === S.tab && vw.querySelector("form") && vw.contains(document.activeElement) && document.activeElement.matches("input,select");
  if (!typing) { vw.innerHTML = VIEWS[S.tab](); vw.dataset.tab = S.tab; bindView(); }
  $("#nav").hidden = false;
  $("#navIn").style.gridTemplateColumns = `repeat(${tabs.length},1fr)`;
  $("#navIn").innerHTML = tabs.map(([k, l]) => `<button type="button" data-tab="${k}" ${k === S.tab ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${ICON[k]}</svg>${l}</button>`).join("");
  if (S.sheet && S.sheet.kind === "store") storeSheet(S.sheet.id);
}
function bindGate() {
  const f = $("#loginForm"); if (!f) return;
  f.addEventListener("submit", async (e) => {
    e.preventDefault(); const m = $("#l-msg"), btn = $("#l-go");
    const email = $("#l-email").value.trim(), password = $("#l-pw").value;
    if (!email || !password) return say(m, "Enter your email and password.", 1);
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) say(m, /banned/i.test(error.message) ? "Your access has been turned off. Contact your admin." : /invalid/i.test(error.message) ? "Email or password is wrong." : error.message, 1);
  });
}
function bindView() {
  const lf = $("#logForm");
  if (lf) lf.addEventListener("submit", async (e) => {
    e.preventDefault(); const msg = $("#f-msg"), btn = $("#f-save");
    const amt = Math.round(num($("#f-amt").value) * 100) / 100, item = $("#f-item").value.trim(), date = $("#f-date").value, storeId = $("#f-store").value, cat = (lf.querySelector("input[name=cat]:checked") || {}).value;
    if (!cat) return say(msg, "Pick a category.", 1);
    if (!item) return say(msg, "Say what it was for.", 1);
    if (!(amt > 0)) return say(msg, "Enter an amount greater than $0.", 1);
    if (!date) return say(msg, "Pick a date.", 1);
    btn.disabled = true;
    try {
      await must(sb.from("spend").insert({ store_id: storeId, category_id: cat, item, vendor: $("#f-vendor").value.trim() || null, amount: amt, spent_on: date }));
      ls.set("tsb-store", storeId); ls.set("tsb-cat", cat);
      $("#f-item").value = ""; $("#f-amt").value = ""; $("#f-vendor").value = "";
      const vis = visibleStores().some((s) => s.id === storeId);
      say(msg, `Saved ${money2(amt)} to ${storeName(storeId)} · ${catName(cat)}.${vis ? "" : " (Not one of your stores, so it won't show on your screen.)"}`);
      document.activeElement && document.activeElement.blur();
      loadAll();
    } catch (err) { say(msg, errText(err), 1); }
    btn.disabled = false;
  });
  const cf = $("#catForm");
  if (cf) cf.addEventListener("submit", (e) => {
    e.preventDefault(); const n = $("#cat-new").value.trim(); if (!n) return;
    if (S.cats.some((c) => !c.archived && c.name.toLowerCase() === n.toLowerCase())) return say($("#cat-msg"), "That category already exists.", 1);
    const sort = S.cats.reduce((a, c) => Math.max(a, c.sort || 0), 0) + 1;
    const ops = [sb.from("categories").insert({ name: n, sort }).select().single()];
    saveCats(ops);
  });
  document.querySelectorAll("input[name=grp]").forEach((r) => r.addEventListener("change", () => { S.group = r.value; render(); }));
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-tab],[data-store],[data-cat],[data-act],[data-del]"); if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; closeSheet(); render(); window.scrollTo(0, 0); return; }
  if (t.dataset.store) return storeSheet(t.dataset.store);
  if (t.dataset.cat) { S.cat = S.cat === t.dataset.cat ? "all" : t.dataset.cat; render(); return; }
  if (t.dataset.del) {
    if (!t.classList.contains("armed")) { t.classList.add("armed"); t.textContent = "Tap to confirm"; return; }
    try { await must(sb.from(t.dataset.del).delete().eq("id", t.dataset.id)); await loadAll(); } catch (err) { t.textContent = "Couldn't remove"; }
    return;
  }
  const a = t.dataset.act, id = t.dataset.id;
  if (a === "move") return moveSheet(id);
  if (a === "edit-store") return editStoreSheet(id);
  if (a === "add-person") return addPersonSheet();
  if (a === "edit-person") return personSheet(id);
  if (a === "csv") return exportCSV();
  if (a === "pr-mark") { t.disabled = true; return markEntered([id], true); }
  if (a === "pr-undo") return markEntered([id], false);
  if (a === "pr-all") { if (!t.dataset.armed) { t.dataset.armed = 1; t.textContent = `Confirm: mark all ${S.queue.length}`; return; } t.disabled = true; return markEntered(S.queue.map((e) => e.id), true); }
  if (a === "signout") return sb.auth.signOut();
  if (a === "archive-cat") { if (!t.dataset.armed) { t.dataset.armed = 1; t.textContent = "Confirm"; return; } return saveCats([sb.from("categories").update({ archived: true }).eq("id", id)]); }
  if (a === "toggle-pay-cat") { const c = S.cats.find((x) => x.id === id); return saveCats([sb.from("categories").update({ pays_people: !c.pays_people }).eq("id", id)]); }
  if (a === "emps") return empListSheet(id || S.pay.storeId);
  if (a === "emp-edit") return empSheet(id);
  if (a === "emp-add") return empSheet("new", t.dataset.store2 || S.pay.storeId);
  if (a === "restore-cat") return saveCats([sb.from("categories").update({ archived: false }).eq("id", id)]);
  if (a === "rename-cat") {
    const c = S.cats.find((x) => x.id === id), row = t.closest(".row");
    row.innerHTML = `<form class="btn-row" style="grid-column:1/-1" id="rn"><input id="rn-v" value="${esc(c.name)}" maxlength="30" style="flex:2;min-width:0;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg)"><button class="btn sm">Save</button></form>`;
    $("#rn-v").focus();
    $("#rn").addEventListener("submit", (ev) => { ev.preventDefault(); const v = $("#rn-v").value.trim(); if (v) saveCats([sb.from("categories").update({ name: v }).eq("id", id)]); });
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.sheet) closeSheet(); });
$("#who").addEventListener("click", accountSheet);
$("#prev").addEventListener("click", () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); closeSheet(); loadAll(); });
$("#next").addEventListener("click", () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); closeSheet(); loadAll(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.me) loadAll(); });

/* ---------- 8. Login & startup ---------- */
async function startSession(user) {
  if (S.loadedFor === user.id) return;
  S.loadedFor = user.id;
  const { data: me } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!me || !me.active) { S.me = null; S.mode = "locked"; render(); return; }
  S.me = me; S.mode = me.role === "admin" ? "admin" : me.role === "district" ? "district" : "manager";
  S.tab = null;
  await loadAll();
}
sb.auth.onAuthStateChange((event, session) => {
  // Run outside the auth callback (Supabase recommends not awaiting inside it).
  setTimeout(() => {
    if (!session) { S.me = null; S.loadedFor = null; S.mode = "login"; closeSheet(); render(); return; }
    startSession(session.user);
  }, 0);
});
render();
})();
