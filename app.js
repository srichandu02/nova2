/* NOVA Smart Local — controller. Wires DOM events to NovaLogic (rules) and NovaViews (templates).
 * Needs logic.js and views.js loaded first. All clicks go through ONE delegated listener (see CLICK_RULES / ACTIONS).
 */
(() => {
  "use strict";
  if (typeof document === "undefined" || !document.getElementById("products")) return;

  const L = globalThis.NovaLogic;
  const V = globalThis.NovaViews;

  const NOTICE_MS = 2500;
  const SEARCH_DEBOUNCE_MS = 150;
  const PERSIST_DELAY_MS = 250;

  const storage = (() => { try { return window.localStorage; } catch (e) { return null; } })();
  const products = L.createProducts();
  const state = { events: 0, pending: null, role: "Customer", query: "", order: null, reserved: {}, assisted: 0, rescued: 0 };

  /* ---------- Small helpers ---------- */

  // Element lookups are cached: the nodes behind these selectors are static for the page lifetime.
  const cache = new Map();
  const $ = (selector) => {
    if (!cache.has(selector)) cache.set(selector, document.querySelector(selector));
    return cache.get(selector);
  };

  // Writes innerHTML only when the markup actually changed, so unchanged panels cost no layout work.
  const lastHtml = new Map();
  function setHtml(selector, html) {
    if (lastHtml.get(selector) === html) return;
    lastHtml.set(selector, html);
    $(selector).innerHTML = html;
  }

  const setText = (selector, text) => { $(selector).textContent = text; };
  const findProduct = (id) => products.find((p) => p.id === id);
  const orderId = () => (state.order ? state.order.id : L.ORDER_ID);
  const debounce = (fn, ms) => {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  };
  const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollToSection = (id) => document.getElementById(id).scrollIntoView(
    { behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  const openExternal = (url) => window.open(url, "_blank", "noopener,noreferrer");

  /* ---------- Persistence (batched: many quick actions produce a single write) ---------- */

  function flushState() {
    clearTimeout(flushState.timer);
    const { order, reserved, events, assisted, rescued } = state;
    L.saveState(storage, L.snapshotOf(products, { order, reserved, events, assisted, rescued }));
  }
  const persist = () => { clearTimeout(flushState.timer); flushState.timer = setTimeout(flushState, PERSIST_DELAY_MS); };

  /* ---------- Feedback ---------- */

  function countEvent() {
    state.events += 1;
    setText("#kpi", state.events);
  }

  function notify(message) {
    const el = $("#notice");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => el.classList.remove("show"), NOTICE_MS);
    countEvent();
    persist();
  }

  function openModal({ title, html }) {
    setText("#modalTitle", title);
    $("#modalBody").innerHTML = html;
    $("#modal").showModal();
  }
  const closeModal = () => $("#modal").close();

  /* ---------- Rendering ---------- */

  function renderProducts(query = state.query) {
    state.query = query;
    const list = L.searchProducts(products, query);
    setHtml("#products", list.length ? list.map(V.productCard).join("") : V.emptyProducts());
  }

  function renderOrder() {
    const o = state.order;
    const status = L.orderStatus(o);
    const badge = $("#orderStatus");
    badge.textContent = status.text;
    badge.className = `badge ${status.badge}`;
    setText("#orderTitle", `Order #${orderId()}`);
    setText("#orderMeta", o ? `${o.item} • ${o.store}${o.customer ? ` • Assisted for ${o.customer}` : ""}` : "Reserve an item to start tracking.");
    const stage = o ? o.stage : 0;
    setHtml("#timeline", V.timelineItems(stage));
    setHtml("#checkpoints", V.checkpointButtons(stage));
  }

  function renderImpact() {
    const community = L.communityStats(state.assisted);
    setText("#statAssisted", community.assisted);
    setText("#statFulfilled", community.fulfilled);
    setText("#statAwaiting", community.awaiting);
    const hq = L.hqMetrics({ reserved: state.reserved, rescued: state.rescued, assisted: state.assisted });
    setText("#hqPrebooked", hq.prebooked);
    setText("#hqRescued", hq.rescued);
    setText("#hqAssisted", hq.assisted);
  }

  // Product cards, stock panel and demand list are all generated from the same data, so they can never disagree.
  function refreshStock() {
    renderProducts();
    setHtml("#stockList", products.map(V.stockRow).join(""));
    setHtml("#demandList", L.demandPlan(products, state.reserved).map(V.planRow).join(""));
    renderImpact();
  }

  function refreshAll() {
    refreshStock();
    renderOrder();
  }

  /* ---------- Actions ---------- */

  // A real order: stores it, counts the pre-booking for demand planning, and moves tracking to stage 2.
  function startOrder(product, store, customer = null) {
    state.order = L.createOrder(product, store, L.ORDER_ID, customer);
    state.reserved[product.id] = (state.reserved[product.id] || 0) + 1;
    refreshAll();
  }

  function openBooking(product) {
    if (!product) return;
    state.pending = product;
    openModal(V.bookingModal(product));
  }

  function confirmReservation() {
    const result = L.reserveStock(products, state.pending && state.pending.id);
    closeModal();
    if (!result.ok) { notify("Sorry, that item just went out of stock."); refreshStock(); return; }
    startOrder(result.product, result.product.store);
    notify("Stock reserved and inventory updated.");
  }

  function reserveFromBackup() {
    const result = L.reserveBackup(products, state.pending && state.pending.id);
    closeModal();
    if (!result.ok) { notify("Backup stock is not available right now."); return; }
    state.rescued += 1;
    startOrder(result.product, result.store);
    notify(`Reserved from ${result.store}.`);
  }

  // Validates the assisted-booking form; shows errors inline instead of silently succeeding.
  function confirmAssisted() {
    const nameEl = document.getElementById("custName");
    const villageEl = document.getElementById("custVillage");
    const { valid, errors, values } = L.validateAssist({ name: nameEl.value, village: villageEl.value });
    nameEl.setAttribute("aria-invalid", String(Boolean(errors.name)));
    villageEl.setAttribute("aria-invalid", String(Boolean(errors.village)));
    document.getElementById("assistError").textContent = errors.name || errors.village || "";
    if (!valid) { (errors.name ? nameEl : villageEl).focus(); return; }

    const result = L.reserveAny(products, document.getElementById("custProduct").value);
    closeModal();
    if (!result.ok) { notify("That item is no longer available. Please pick another product."); refreshStock(); return; }
    state.assisted += 1;
    if (result.backup) state.rescued += 1;
    startOrder(result.product, result.store, `${values.name}, ${values.village}`);
    notify(`Assisted booking created for ${values.name}, ${values.village}.`);
  }

  function sellInStore(id) {
    if (!L.sellOne(products, id)) return;
    refreshStock();
    notify("Stock updated immediately across the demo.");
  }

  // Replacement / alternative / refund are recorded on the active order.
  function resolve(type, message) {
    closeModal();
    if (!state.order) { notify("Create an order first, then choose a resolution."); return; }
    state.order = L.resolveOrder(state.order, type);
    renderOrder();
    notify(message);
  }

  // Checkpoints must be recorded in order; the current one advances the order and the timeline.
  function recordCheckpoint(key) {
    const index = V.CHECKPOINTS.findIndex(([k]) => k === key);
    if (!state.order) { notify("Reserve an item first, then record checkpoints."); return; }
    if (index !== state.order.stage) { notify("Record checkpoints in order."); return; }
    state.order = L.advanceOrder(state.order);
    renderOrder();
    notify(`${key} checkpoint recorded.`);
  }

  function showPlan() {
    openModal(V.planModal(L.demandPlan(products, state.reserved)));
    notify("Demand-based stock preparation plan created.");
  }

  function resetDemo() {
    products.splice(0, products.length, ...L.createProducts());
    Object.assign(state, { order: null, reserved: {}, events: 0, assisted: 0, rescued: 0 });
    setText("#kpi", 0);
    refreshAll();
    notify("Demo reset to starting data.");
  }

  function switchRole() {
    const role = L.nextRole(state.role);
    state.role = role.name;
    setText("#role", `${role.name} ▾`);
    $("#role").setAttribute("aria-label", `Switch role view. Current role: ${role.name}`);
    scrollToSection(role.section);
    notify(`Viewing as ${role.name}.`);
  }

  // Loads the Google Maps embed only when asked, so the page stays light.
  function toggleMap() {
    const box = $("#mapBox");
    const button = $("#showMap");
    const opening = !box.firstChild;
    box.textContent = "";
    if (opening) {
      const frame = document.createElement("iframe");
      frame.className = "map";
      frame.title = `Google Map showing ${L.STORE_QUERY}`;
      frame.loading = "lazy";
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      frame.referrerPolicy = "no-referrer-when-downgrade";
      frame.src = L.mapsEmbedUrl(L.STORE_QUERY);
      box.appendChild(frame);
      countEvent();
    }
    button.setAttribute("aria-expanded", String(opening));
    button.textContent = opening ? "Hide map" : "Show map here";
  }

  function addCalendarReminder() {
    const start = new Date(Date.now() + 30 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    countEvent();
    openExternal(L.calendarUrl({
      title: `NOVA delivery #${orderId()}`,
      details: "Reminder: collect your NOVA Smart Local order.",
      start, end
    }));
  }

  function emailOrderSummary() {
    if (!state.order) { notify("Create an order first, then email the summary."); return; }
    countEvent();
    openExternal(L.gmailComposeUrl({ subject: `NOVA order #${orderId()}`, body: L.orderSummary(state.order) }));
  }

  const openLink = (buildUrl) => () => { countEvent(); openExternal(buildUrl()); };
  const done = (message) => () => { closeModal(); notify(message); };

  /* ---------- Event wiring: one delegated click listener ---------- */

  const MODALS = {
    ...Object.fromEntries(Object.entries(V.STATIC_MODALS).map(([key, content]) => [key, () => openModal(content)])),
    assist: () => { openModal(V.assistModal(L.bookableProducts(products))); document.getElementById("custName").focus(); },
    trust: () => openModal(V.trustModal(products[0], orderId()))
  };

  // Button id -> handler. Modal buttons and header/toolbar buttons share this table.
  const ACTIONS = {
    search: () => renderProducts($("#q").value),
    help: () => openModal(V.helpModal()),
    reset: resetDemo,
    role: switchRole,
    close: closeModal,
    prepare: showPlan,
    showMap: toggleMap,
    maps: openLink(() => L.mapsSearchUrl(L.STORE_QUERY + " near me")),
    directions: openLink(() => L.mapsDirectionsUrl(L.STORE_QUERY)),
    calendar: addCalendarReminder,
    email: emailOrderSummary,
    confirm: confirmReservation,
    backup: reserveFromBackup,
    assistConfirm: confirmAssisted,
    call: done("Protected call flow started."),
    replace: () => resolve("replacement", "Replacement confirmed."),
    alt: () => openModal(V.alternativesModal()),
    chooseAlt: () => resolve("alternative", "Alternative selected for customer confirmation."),
    refund: () => resolve("refund", "Traceable refund request created.")
  };

  // [selector, handler] pairs checked in order; the first match wins.
  const CLICK_RULES = [
    [".book", (el) => { countEvent(); openBooking(findProduct(el.dataset.id)); }],
    [".trust", (el) => { countEvent(); const p = findProduct(el.dataset.id); if (p) openModal(V.trustModal(p, orderId())); }],
    ["[data-open]", (el) => { countEvent(); if (Object.hasOwn(MODALS, el.dataset.open)) MODALS[el.dataset.open](); }],
    ["[data-scroll]", (el) => scrollToSection(el.dataset.scroll)],
    [".sell", (el) => sellInStore(el.dataset.id)],
    ["[data-check]", (el) => recordCheckpoint(el.dataset.check)]
  ];

  function handleClick(event) {
    for (const [selector, run] of CLICK_RULES) {
      const el = event.target.closest(selector);
      if (el) { run(el); return; }
    }
    const button = event.target.closest("button[id]");
    if (button && Object.hasOwn(ACTIONS, button.id)) ACTIONS[button.id]();
  }

  // Offline cache for low-connectivity villages; only on http(s) (service workers do not run from file://).
  function registerOfflineCache() {
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  function init() {
    document.addEventListener("click", handleClick);
    $("#q").addEventListener("input", debounce((e) => renderProducts(e.target.value), SEARCH_DEBOUNCE_MS));
    $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") renderProducts(e.target.value); });
    // Clicking the dimmed backdrop closes the dialog (Esc already works natively).
    $("#modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
    // Flush any batched save when the tab is hidden or closed.
    window.addEventListener("pagehide", flushState);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushState(); });

    Object.assign(state, L.restoreState(products, L.loadState(storage)));
    setText("#kpi", state.events);
    renderProducts("");
    refreshAll();
    registerOfflineCache();
  }

  init();
})();
