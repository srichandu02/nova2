/* NOVA Smart Local — pure business logic (no DOM).
 * Exported as NovaLogic so tests.js can verify it in Node and the browser; app.js is the UI layer.
 */
(function (root) {
  "use strict";

  /**
   * @typedef {{id: string, name: string, price: number, stock: number, store: string, confidence: number,
   *   eta: string, batch: string, bestBefore: string, backupStock?: number}} Product
   * @typedef {{id: string, item: string, store: string, stage: number, resolution: (string|null), customer: (string|null)}} Order
   */

  const BACKUP_STORE = "Rythu Partner Store";
  const LOW_STOCK_LIMIT = 5;
  const MAX_FIELD_LENGTH = 60;
  const MAX_STAGE = 4;
  const ORDER_ID = "NSL-1042";
  const STORAGE_KEY = "nova-smart-local:v2";
  const RESOLUTIONS = Object.freeze({
    replacement: "Replacement confirmed", alternative: "Alternative chosen", refund: "Refund requested"
  });

  // Fresh copy each call so callers (and tests) never share mutable state.
  const createProducts = () => [
    { id: "rice", name: "Basmati Rice 5kg", price: 620, stock: 12, store: "Sri Lakshmi Store", confidence: 96, eta: "28–35 min",
      batch: "BAT-2026-041", bestBefore: "20 Sep 2027" },
    { id: "milk", name: "Fresh Milk 1L", price: 62, stock: 4, store: "Village Fresh Mart", confidence: 88, eta: "18–25 min",
      batch: "BAT-2026-052", bestBefore: "05 Oct 2026" },
    { id: "honey", name: "Local Honey 500g", price: 280, stock: 0, store: BACKUP_STORE, confidence: 0, eta: "Backup required", backupStock: 6,
      batch: "BAT-2026-017", bestBefore: "30 Jun 2027" }
  ];

  /**
   * Escapes user-controlled text before it is placed in innerHTML.
   * @param {*} x any value
   * @returns {string} HTML-safe string
   */
  function esc(x) {
    return String(x).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /** Case-insensitive name search; an empty query returns everything. */
  function searchProducts(products, query) {
    const term = String(query || "").toLowerCase().trim();
    return products.filter(p => !term || p.name.toLowerCase().includes(term));
  }

  /**
   * Locks stock for an order. Never lets stock go negative.
   * @returns {{ok: boolean, product?: object, reason?: string, backupStore?: string}}
   */
  function reserveStock(products, id, qty = 1) {
    if (!Number.isInteger(qty) || qty < 1) return { ok: false, reason: "invalid_quantity" };
    const product = products.find(p => p.id === id);
    if (!product) return { ok: false, reason: "not_found" };
    if (product.stock < qty) return { ok: false, reason: "unavailable", backupStore: BACKUP_STORE };
    product.stock -= qty;
    return { ok: true, product };
  }

  // Partner store sells one unit in-store; stock floors at 0.
  function sellOne(products, id) {
    const product = products.find(p => p.id === id);
    if (!product) return null;
    product.stock = Math.max(0, product.stock - 1);
    return product;
  }

  const ROLES = Object.freeze([
    { name: "Customer", section: "customer" },
    { name: "Community Store", section: "community" },
    { name: "Partner Store", section: "store" },
    { name: "HQ", section: "control" }
  ].map(Object.freeze));

  // Cycles Customer -> Community Store -> Partner Store -> HQ -> Customer. Unknown names restart at Customer.
  function nextRole(currentName) {
    const i = ROLES.findIndex(r => r.name === currentName);
    return ROLES[(i + 1) % ROLES.length];
  }

  // Text/badge info for a product card, derived from stock.
  function availabilityInfo(p) {
    if (p.stock > 0) {
      const left = p.stock <= LOW_STOCK_LIMIT ? `Only ${p.stock} left • ` : "";
      return { label: "Available", badge: "green", cta: "Pre-book", detail: `${left}Availability confidence ${p.confidence}% • ${p.eta}` };
    }
    return { label: "Unavailable", badge: "red", cta: "Find backup",
      detail: p.backupStock > 0 ? "NOVA can reserve from a nearby partner store." : "No nearby partner stock right now." };
  }

  // Order tracking steps. `stage` = number of completed steps (0-4).
  function buildTimeline(stage = 2) {
    const steps = [
      ["Booked", "Customer request accepted"], ["Reserved", "Stock locked"],
      ["Local handover", "Community checkpoint"], ["Delivered", "Customer receives item"]
    ];
    return steps.map(([title, detail], i) => ({
      title, detail,
      icon: i < stage ? "✓" : String(i + 1),
      status: i < stage ? "done" : i === stage ? "current" : "pending"
    }));
  }

  /** Stock badge for the partner-store panel: Unavailable / Low / In stock. */
  function stockLevel(p) {
    if (p.stock === 0) return { label: "Unavailable", badge: "red" };
    return p.stock <= LOW_STOCK_LIMIT ? { label: "Low", badge: "orange" } : { label: "In stock", badge: "green" };
  }

  /**
   * Validates the Community Store assisted-booking form.
   * @returns {{valid: boolean, errors: object, values: {name: string, village: string}}}
   */
  function validateAssist({ name = "", village = "" } = {}) {
    const clean = (s) => String(s).replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_LENGTH);
    const values = { name: clean(name), village: clean(village) };
    const errors = {};
    if (values.name.length < 2) errors.name = "Enter the customer's name (2+ letters).";
    if (values.village.length < 2) errors.village = "Enter the village name.";
    return { valid: Object.keys(errors).length === 0, errors, values };
  }

  /** Reserves one unit from the backup partner store when the main store is out of stock. */
  function reserveBackup(products, id) {
    const p = products.find((x) => x.id === id);
    if (!p) return { ok: false, reason: "not_found" };
    if (p.stock > 0) return { ok: false, reason: "in_stock" };
    if (!(p.backupStock > 0)) return { ok: false, reason: "no_backup" };
    p.backupStock -= 1;
    return { ok: true, product: p, store: BACKUP_STORE };
  }

  /** New order that is already booked + reserved (stage 2 of 4). `customer` is set for Community Store assisted orders. */
  const createOrder = (product, store, id = ORDER_ID, customer = null) =>
    ({ id, item: product.name, store, stage: 2, resolution: null, customer });

  /** Immutable: returns a copy one tracking stage further (capped at delivered). */
  const advanceOrder = (order) => (order ? { ...order, stage: Math.min(MAX_STAGE, order.stage + 1) } : null);

  /** Immutable: records replacement / alternative / refund on the order. */
  function resolveOrder(order, type) {
    return order && RESOLUTIONS[type] ? { ...order, resolution: RESOLUTIONS[type] } : order || null;
  }

  /** Text + badge colour for the order header. */
  function orderStatus(order) {
    if (!order) return { text: "No active order", badge: "blue" };
    if (order.resolution) return { text: `${order.resolution} • #${order.id}`, badge: "orange" };
    if (order.stage >= MAX_STAGE) return { text: `Delivered • #${order.id}`, badge: "green" };
    const backup = order.store === BACKUP_STORE;
    return { text: `${backup ? "Backup reserved" : "Reserved"} • #${order.id}`, badge: backup ? "blue" : "green" };
  }

  /** Stock-preparation advice: pre-bookings x2, +4 when stock is low, +2 safety buffer. Highest first. */
  function demandPlan(products, reserved = {}) {
    return products.map((p) => {
      const booked = reserved[p.id] || 0;
      return { id: p.id, name: p.name, booked, prepare: booked * 2 + (p.stock <= LOW_STOCK_LIMIT ? 4 : 0) + 2 };
    }).sort((a, b) => b.prepare - a.prepare);
  }

  /* ---- persistence (storage is injected so it can be tested and may be null/blocked) ---- */
  function saveState(storage, snapshot) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); return true; } catch (e) { return false; }
  }

  function loadState(storage) {
    try {
      const data = JSON.parse(storage.getItem(STORAGE_KEY));
      return data && typeof data === "object" ? data : null;
    } catch (e) { return null; }
  }

  function snapshotOf(products, extra = {}) {
    return { ...extra, stock: Object.fromEntries(products.map((p) => [p.id, { stock: p.stock, backupStock: p.backupStock || 0 }])) };
  }

  /** Applies a saved snapshot to products and returns sanitised {order, reserved, events}. Bad data is ignored. */
  function restoreState(products, snap) {
    const count = (n) => Number.isInteger(n) && n >= 0;
    const saved = (snap && snap.stock) || {};
    products.forEach((p) => {
      const v = saved[p.id];
      if (v && count(v.stock)) { p.stock = v.stock; if (count(v.backupStock)) p.backupStock = v.backupStock; }
    });
    const o = snap && snap.order;
    const order = o && typeof o.id === "string" && count(o.stage) && o.stage <= MAX_STAGE
      ? { id: o.id, item: String(o.item), store: String(o.store), stage: o.stage, resolution: o.resolution ? String(o.resolution) : null,
        customer: o.customer ? String(o.customer).slice(0, 2 * MAX_FIELD_LENGTH + 2) : null }
      : null;
    const reserved = {};
    Object.entries((snap && snap.reserved) || {}).forEach(([k, v]) => { if (Number.isInteger(v) && v > 0) reserved[k] = v; });
    return { order, reserved, events: snap && count(snap.events) ? snap.events : 0,
      assisted: snap && count(snap.assisted) ? snap.assisted : 0, rescued: snap && count(snap.rescued) ? snap.rescued : 0 };
  }

  /**
   * One call for the Community Store: reserve from the main store, falling back to the backup partner store.
   * @returns {{ok: boolean, product?: Product, store?: string, backup?: boolean, reason?: string}}
   */
  function reserveAny(products, id) {
    const main = reserveStock(products, id);
    if (main.ok) return { ok: true, product: main.product, store: main.product.store, backup: false };
    if (main.reason !== "unavailable") return { ok: false, reason: main.reason };
    const backup = reserveBackup(products, id);
    return backup.ok ? { ...backup, backup: true } : backup;
  }

  /** Plain-text order summary used for the Gmail draft. */
  function orderSummary(order) {
    if (!order) return "";
    return [`Order #${order.id}`, `Item: ${order.item}`, `Store: ${order.store}`, `Status: ${orderStatus(order).text}`]
      .concat(order.customer ? [`Customer: ${order.customer}`] : []).join("\n");
  }

  /** Live "business impact" numbers for the HQ panel, derived from what happened in this session. */
  function hqMetrics({ reserved = {}, rescued = 0, assisted = 0 } = {}) {
    const prebooked = Object.values(reserved).reduce((sum, n) => sum + (Number.isInteger(n) && n > 0 ? n : 0), 0);
    const clean = (n) => (Number.isInteger(n) && n > 0 ? n : 0);
    return { prebooked, rescued: clean(rescued), assisted: clean(assisted) };
  }

  const BASE_ASSISTED = 28;
  const BASE_FULFILLED = 24;

  /** Community Store dashboard numbers: seeded demo baseline plus assisted orders created this session. */
  function communityStats(assistedThisSession = 0) {
    const n = Number.isInteger(assistedThisSession) && assistedThisSession > 0 ? assistedThisSession : 0;
    const assisted = BASE_ASSISTED + n;
    return { assisted, fulfilled: BASE_FULFILLED, awaiting: assisted - BASE_FULFILLED };
  }

  /** Products a Community Store operator can book right now (in stock, or covered by backup stock). */
  const bookableProducts = (products) => products.filter((p) => p.stock > 0 || p.backupStock > 0);

  function mapsSearchUrl(query) {
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(query);
  }

  const STORE_QUERY = "Sri Lakshmi Store";

  // Google Maps turn-by-turn directions link (no API key needed).
  function mapsDirectionsUrl(destination) {
    return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(destination);
  }

  // Gmail compose link with a pre-filled subject and body (no API key needed).
  function gmailComposeUrl({ subject = "", body = "" } = {}) {
    return "https://mail.google.com/mail/?view=cm&fs=1&su=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  // Google Maps embed URL (no API key needed).
  function mapsEmbedUrl(query) {
    return "https://www.google.com/maps?output=embed&q=" + encodeURIComponent(query);
  }

  // Google Calendar "add event" link. start/end are Date objects.
  function calendarUrl({ title, details = "", start, end }) {
    const fmt = (d) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
    return "https://calendar.google.com/calendar/render?action=TEMPLATE"
      + "&text=" + encodeURIComponent(title)
      + "&details=" + encodeURIComponent(details)
      + "&dates=" + fmt(start) + "/" + fmt(end);
  }

  const api = Object.freeze({
    // data + constants
    BACKUP_STORE, STORE_QUERY, ORDER_ID, LOW_STOCK_LIMIT, MAX_FIELD_LENGTH, MAX_STAGE, RESOLUTIONS, ROLES, createProducts,
    // text safety, search, validation
    esc, searchProducts, validateAssist,
    // stock + orders
    reserveStock, reserveBackup, reserveAny, sellOne, createOrder, advanceOrder, resolveOrder, bookableProducts,
    // derived view data
    availabilityInfo, stockLevel, buildTimeline, orderStatus, orderSummary, demandPlan, communityStats, hqMetrics, nextRole,
    // persistence
    saveState, loadState, snapshotOf, restoreState,
    // Google service links
    mapsSearchUrl, mapsEmbedUrl, mapsDirectionsUrl, calendarUrl, gmailComposeUrl
  });
  root.NovaLogic = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
