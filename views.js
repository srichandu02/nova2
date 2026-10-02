/* NOVA Smart Local — view templates.
 * Pure functions: data in, HTML string out. Every dynamic value goes through esc(), and nothing here touches the DOM,
 * so the templates can be unit-tested (including XSS cases) in Node. Needs logic.js (NovaLogic) loaded first.
 */
(function (root) {
  "use strict";

  const L = root.NovaLogic || (typeof require === "function" ? require("./logic.js") : null);
  const { esc, availabilityInfo, stockLevel, buildTimeline, BACKUP_STORE } = L;

  /** Tracking checkpoints recorded by responsible local roles, in order. */
  const CHECKPOINTS = Object.freeze([["Packed", "Store packed"], ["Handover", "Community handover"],
    ["Delivery", "Delivery partner"], ["Received", "Customer received"]]);

  const modalButton = (id, label) => `<button id="${esc(id)}" type="button" class="primary full">${esc(label)}</button>`;
  const modal = (title, html) => ({ title, html });

  function productCard(p) {
    const info = availabilityInfo(p);
    return `
      <article class="product">
        <span class="badge ${info.badge}">${esc(info.label)}</span>
        <h3>${esc(p.name)}</h3>
        <small>₹${esc(p.price)} • ${esc(p.store)}</small>
        <small>${esc(info.detail)}</small>
        <div class="buttons">
          <button type="button" class="primary book" data-id="${esc(p.id)}">${esc(info.cta)}</button>
          <button type="button" class="secondary trust" data-id="${esc(p.id)}" aria-label="Product trust details for ${esc(p.name)}">Trust</button>
        </div>
      </article>`;
  }

  const emptyProducts = () => "<article class='card'><b>No product found.</b><p>Try another search or ask the Community Store.</p></article>";

  const STATUS_TEXT = { done: "Completed", current: "In progress", pending: "Pending" };

  function timelineItems(stage) {
    return buildTimeline(stage).map((step) => `
      <li class="t ${step.status === "pending" ? "" : step.status}"${step.status === "current" ? ' aria-current="step"' : ""}>
        <span class="dot" aria-hidden="true">${esc(step.icon)}</span>
        <div><b>${esc(step.title)}</b><small>${esc(step.detail)}</small><span class="sr">${STATUS_TEXT[step.status]}</span></div>
      </li>`).join("");
  }

  function checkpointButtons(stage) {
    return CHECKPOINTS.map(([key, label], i) => {
      const cls = i < stage ? "done" : i === stage ? "current" : "";
      return `<button type="button" class="checkpoint ${cls}" data-check="${esc(key)}" aria-pressed="${i < stage}"
        aria-label="Checkpoint ${i + 1}: ${esc(label)}">${i + 1}<br><small>${esc(label)}</small></button>`;
    }).join("");
  }

  const planRow = (r) =>
    `<div class="recommend"><b>${esc(r.name)}</b><span>Prepare +${esc(r.prepare)} (${esc(r.booked)} pre-booked)</span></div>`;

  function stockRow(p) {
    const level = stockLevel(p);
    const backup = p.backupStock > 0 ? `<small>Backup: ${esc(p.backupStock)} at ${esc(BACKUP_STORE)}</small>` : "";
    return `<div class="stock"><span><b>${esc(p.name)}</b><small>${esc(p.stock)} available</small>${backup}</span>
      <span class="stock-actions"><span class="badge ${level.badge}">${esc(level.label)}</span>
      <button type="button" class="primary mini sell" data-id="${esc(p.id)}" aria-label="Sell one ${esc(p.name)} in store"
        ${p.stock === 0 ? "disabled" : ""}>Sell 1</button></span></div>`;
  }

  /* ---------- Modals: each returns {title, html} ---------- */

  const trustModal = (p, orderId) => modal("Product Trust", `
      <div class="callout"><b>Verified demo traceability</b>
        <p>Source: ${esc(p.store)}<br>Batch: ${esc(p.batch)}<br>Best before: ${esc(p.bestBefore)}<br>
        Customer: linked to order #${esc(orderId)}</p>
      </div>
      <p class="muted">In production, source, batch and expiry values should come from authenticated store/farmer/company records.</p>`);

  function bookingModal(p) {
    if (p.stock > 0) {
      return modal("Pre-book + Stock Lock", `
      <p><b>${esc(p.name)}</b> is currently available.</p>
      <p>Store: ${esc(p.store)}<br>Availability confidence: ${esc(p.confidence)}%<br>Estimated delivery: ${esc(p.eta)}</p>
      ${modalButton("confirm", "Confirm reservation")}`);
    }
    const advice = p.backupStock > 0
      ? `<p>Recommendation: reserve from <b>${esc(BACKUP_STORE)}</b> (${esc(p.backupStock)} in stock).</p>${modalButton("backup", "Reserve backup store")}`
      : "<p>No nearby partner store has this item right now. Try an alternative product or check again later.</p>";
    return modal("Backup Local Store", `<p><b>${esc(p.name)}</b> is unavailable in the selected store.</p>${advice}`);
  }

  function assistModal(options) {
    const choices = options.map((p) =>
      `<option value="${esc(p.id)}">${esc(p.name)}${p.stock > 0 ? "" : " (backup store)"}</option>`).join("");
    const field = (id, label, placeholder) => `<div class="formrow"><label for="${id}">${label}</label>
        <input id="${id}" placeholder="${placeholder}" maxlength="60" autocomplete="off" required aria-describedby="assistError"></div>`;
    return modal("Community Store Assisted Order", `
      <p>The operator can place the order for the customer and confirm choices.</p>
      ${field("custName", "Customer name", "Enter customer name")}
      ${field("custVillage", "Village", "Enter village")}
      <div class="formrow"><label for="custProduct">Product</label><select id="custProduct">${choices}</select></div>
      <p id="assistError" class="error" role="alert"></p>
      ${modalButton("assistConfirm", "Create assisted booking")}`);
  }

  const alternativesModal = () => modal("Alternatives", `
      <p>1. Local Honey 500g — ₹280 — verified partner stock</p>
      <p>2. Forest Honey 500g — ₹310 — verified partner stock</p>
      ${modalButton("chooseAlt", "Choose first alternative")}`);

  const planModal = (rows) => modal("Stock preparation plan",
    `${rows.map(planRow).join("")}<p class="muted">Computed from pre-bookings and low stock in this session.</p>`);

  const helpModal = () => modal("How NOVA Smart Local works", `
      <p><b>1. Input:</b> customer searches or asks a Community Store.</p>
      <p><b>2. Logic:</b> check availability, reserve stock, predict demand and find backup local fulfillment.</p>
      <p><b>3. Action:</b> store/community/delivery roles update the order.</p>
      <p><b>4. Output:</b> reliable fulfillment, clear tracking and measurable business signals.</p>`);

  /** Modals that need no data. Keys match the data-open attributes in index.html. */
  const STATIC_MODALS = Object.freeze({
    reward: modal("Experience Rewards", `
      <p>Instead of relying only on confusing coupons, NOVA can offer clear partner experiences.</p>
      <p>Examples: movie, dining or travel offers, subject to partner terms.</p>
      <div class="callout"><b>Proposed NOVA 15× Dine</b><br>15 eligible orders in a month → proposed dinner for two up to ₹1,500.</div>`),
    call: modal("Protected Customer Contact", `
      <p>Use a platform-controlled or masked calling workflow so personal phone numbers are not exposed.</p>
      ${modalButton("call", "Start protected call")}`),
    replacement: modal("Replacement", `
      <p>Choose a replacement from verified nearby stock.</p>${modalButton("replace", "Confirm replacement")}`),
    alternative: modal("Alternative Product", `
      <p>Show a similar verified product with price and availability before customer confirmation.</p>
      ${modalButton("alt", "Show alternatives")}`),
    refund: modal("Refund / Resolution", `
      <p>First offer a replacement or alternative when appropriate. If the customer chooses refund, create a traceable refund request.</p>
      ${modalButton("refund", "Create refund request")}`)
  });

  const api = Object.freeze({
    CHECKPOINTS, STATIC_MODALS, productCard, emptyProducts, timelineItems, checkpointButtons, planRow, stockRow,
    trustModal, bookingModal, assistModal, alternativesModal, planModal, helpModal
  });
  root.NovaViews = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
