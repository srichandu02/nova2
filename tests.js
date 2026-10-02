/* Run in terminal: `node tests.js` (or `npm test`). Run in browser: open tests.html. */
(() => {
  const isNode = typeof require === "function" && typeof module === "object";
  const L = isNode ? require("./logic.js") : window.NovaLogic;
  const V = isNode ? require("./views.js") : window.NovaViews;
  const results = [];
  const test = (name, fn) => {
    try { fn(); results.push({ name, pass: true }); }
    catch (e) { results.push({ name, pass: false, detail: e.message }); }
  };
  const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const ok = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
  const byId = (ps, id) => ps.find(p => p.id === id);

  // --- esc (security) ---
  test("esc blocks script injection", () => ok(!L.esc("<script>alert(1)</script>").includes("<")));
  test("esc escapes quotes and ampersand", () => eq(L.esc(`a&b"c'd`), "a&amp;b&quot;c&#39;d"));
  test("esc handles numbers and empty values", () => { eq(L.esc(42), "42"); eq(L.esc(""), ""); });

  // --- product data ---
  test("createProducts returns 3 products", () => eq(L.createProducts().length, 3));
  test("createProducts returns independent copies", () => {
    const a = L.createProducts(); a[0].stock = 0;
    eq(L.createProducts()[0].stock, 12);
  });
  test("unavailable products have 0 confidence", () =>
    L.createProducts().filter(p => p.stock === 0).forEach(p => eq(p.confidence, 0)));

  // --- search ---
  test("empty search returns all products", () => eq(L.searchProducts(L.createProducts(), "").length, 3));
  test("search is case-insensitive", () => eq(L.searchProducts(L.createProducts(), "RICE")[0].id, "rice"));
  test("search trims whitespace", () => eq(L.searchProducts(L.createProducts(), "  milk ")[0].id, "milk"));
  test("search with no match returns empty list", () => eq(L.searchProducts(L.createProducts(), "xyz"), []));
  test("search handles null/undefined query", () => {
    eq(L.searchProducts(L.createProducts(), null).length, 3);
    eq(L.searchProducts(L.createProducts(), undefined).length, 3);
  });
  test("search treats HTML as plain text", () => eq(L.searchProducts(L.createProducts(), "<img onerror=x>"), []));

  // --- reserveStock (core reliability logic) ---
  test("reserve decrements stock by 1", () => {
    const ps = L.createProducts(); const r = L.reserveStock(ps, "rice");
    ok(r.ok); eq(byId(ps, "rice").stock, 11);
  });
  test("reserve supports quantity > 1", () => {
    const ps = L.createProducts(); L.reserveStock(ps, "rice", 5); eq(byId(ps, "rice").stock, 7);
  });
  test("reserve fails on out-of-stock item and suggests backup store", () => {
    const ps = L.createProducts(); const r = L.reserveStock(ps, "honey");
    eq(r.ok, false); eq(r.reason, "unavailable"); eq(r.backupStore, L.BACKUP_STORE);
  });
  test("reserve fails when quantity exceeds stock and leaves stock unchanged", () => {
    const ps = L.createProducts(); const r = L.reserveStock(ps, "milk", 5);
    eq(r.ok, false); eq(byId(ps, "milk").stock, 4);
  });
  test("stock never goes negative after repeated reservations", () => {
    const ps = L.createProducts();
    for (let i = 0; i < 20; i++) L.reserveStock(ps, "milk");
    eq(byId(ps, "milk").stock, 0);
  });
  test("reserve rejects unknown product id", () => eq(L.reserveStock(L.createProducts(), "nope").reason, "not_found"));
  test("reserve rejects invalid quantities", () =>
    [0, -1, 1.5, NaN].forEach(q => eq(L.reserveStock(L.createProducts(), "rice", q).reason, "invalid_quantity")));

  // --- sellOne (partner store stock sync) ---
  test("sellOne decrements stock", () => { const ps = L.createProducts(); L.sellOne(ps, "rice"); eq(byId(ps, "rice").stock, 11); });
  test("sellOne floors at 0", () => { const ps = L.createProducts(); L.sellOne(ps, "honey"); eq(byId(ps, "honey").stock, 0); });
  test("sellOne returns null for unknown id", () => eq(L.sellOne(L.createProducts(), "nope"), null));
  test("in-store sale reduces what customers can reserve", () => {
    const ps = L.createProducts(); for (let i = 0; i < 4; i++) L.sellOne(ps, "milk");
    eq(L.reserveStock(ps, "milk").ok, false);
  });


  // --- availabilityInfo ---
  test("availabilityInfo: in-stock product", () => {
    const i = L.availabilityInfo(byId(L.createProducts(), "rice"));
    eq(i.label, "Available"); eq(i.badge, "green"); eq(i.cta, "Pre-book"); ok(i.detail.includes("96%"));
  });
  test("availabilityInfo: out-of-stock product offers backup", () => {
    const i = L.availabilityInfo(byId(L.createProducts(), "honey"));
    eq(i.label, "Unavailable"); eq(i.badge, "red"); eq(i.cta, "Find backup");
  });
  test("availabilityInfo flips to unavailable once last unit is reserved", () => {
    const ps = L.createProducts(); L.reserveStock(ps, "milk", 4);
    eq(L.availabilityInfo(byId(ps, "milk")).label, "Unavailable");
  });

  // --- buildTimeline ---
  test("buildTimeline default: 2 done, 1 current, 1 pending", () =>
    eq(L.buildTimeline().map(s => s.status), ["done", "done", "current", "pending"]));
  test("buildTimeline stage 0 starts at first step", () =>
    eq(L.buildTimeline(0).map(s => s.status), ["current", "pending", "pending", "pending"]));
  test("buildTimeline stage 4 is fully complete", () => ok(L.buildTimeline(4).every(s => s.status === "done")));
  test("buildTimeline uses check marks for done steps and numbers otherwise", () =>
    eq(L.buildTimeline().map(s => s.icon), ["✓", "✓", "3", "4"]));

  // --- mapsSearchUrl ---
  test("mapsSearchUrl points to Google Maps over https", () => ok(L.mapsSearchUrl("x").startsWith("https://www.google.com/maps/search/")));
  test("mapsSearchUrl encodes special characters", () => ok(!L.mapsSearchUrl("a b&c").includes(" ") && L.mapsSearchUrl("a b&c").endsWith("a%20b%26c")));

  // --- Google services ---
  test("mapsEmbedUrl builds a keyless Google Maps embed URL", () => {
    const u = L.mapsEmbedUrl("Sri Lakshmi Store");
    ok(u.startsWith("https://www.google.com/maps?output=embed")); ok(u.endsWith("Sri%20Lakshmi%20Store"));
  });
  test("calendarUrl formats UTC dates for Google Calendar", () => {
    const u = L.calendarUrl({ title: "A&B", start: new Date("2026-10-02T12:00:00Z"), end: new Date("2026-10-02T12:30:00Z") });
    ok(u.startsWith("https://calendar.google.com/calendar/render?action=TEMPLATE"));
    ok(u.includes("dates=20261002T120000Z/20261002T123000Z")); ok(u.includes("text=A%26B"));
  });
  test("calendarUrl encodes details text", () =>
    ok(L.calendarUrl({ title: "t", details: "x y", start: new Date(0), end: new Date(1000) }).includes("details=x%20y")));

  // --- stockLevel / validateAssist ---
  test("stockLevel: unavailable, low and in-stock", () => {
    const ps = L.createProducts();
    eq(L.stockLevel(byId(ps, "honey")).label, "Unavailable");
    eq(L.stockLevel(byId(ps, "milk")).label, "Low");
    eq(L.stockLevel(byId(ps, "rice")).label, "In stock");
  });
  test("stockLevel switches to Low as stock is sold", () => {
    const ps = L.createProducts(); for (let i = 0; i < 7; i++) L.sellOne(ps, "rice");
    eq(L.stockLevel(byId(ps, "rice")).badge, "orange");
  });
  test("validateAssist accepts a normal name and village", () => eq(L.validateAssist({ name: "Ravi", village: "Rythu Nagar" }).valid, true));
  test("validateAssist rejects empty or missing fields", () => {
    eq(L.validateAssist({}).valid, false); eq(Object.keys(L.validateAssist({ name: " ", village: "" }).errors), ["name", "village"]);
  });
  test("validateAssist trims, collapses spaces and caps length", () => {
    const v = L.validateAssist({ name: "  Ravi   Kumar ", village: "x".repeat(500) }).values;
    eq(v.name, "Ravi Kumar"); eq(v.village.length, L.MAX_FIELD_LENGTH);
  });
  test("validateAssist output is inert once escaped", () =>
    ok(!L.esc(L.validateAssist({ name: "<b>Hi</b>", village: "V1" }).values.name).includes("<")));
  test("NovaLogic API and ROLES are frozen (immutable)", () => { ok(Object.isFrozen(L)); ok(Object.isFrozen(L.ROLES)); });

  // --- backup store, orders, demand plan ---
  test("reserveBackup uses backup stock only when the main store is out", () => {
    const ps = L.createProducts(); const r = L.reserveBackup(ps, "honey");
    ok(r.ok); eq(r.store, L.BACKUP_STORE); eq(byId(ps, "honey").backupStock, 5);
  });
  test("reserveBackup refuses in-stock, unknown and exhausted items", () => {
    const ps = L.createProducts();
    eq(L.reserveBackup(ps, "rice").reason, "in_stock"); eq(L.reserveBackup(ps, "x").reason, "not_found");
    for (let i = 0; i < 6; i++) L.reserveBackup(ps, "honey");
    eq(L.reserveBackup(ps, "honey").reason, "no_backup"); eq(byId(ps, "honey").backupStock, 0);
  });
  test("createOrder starts at stage 2 and advanceOrder caps at delivered", () => {
    let o = L.createOrder(byId(L.createProducts(), "rice"), "S"); eq(o.stage, 2);
    for (let i = 0; i < 6; i++) o = L.advanceOrder(o);
    eq(o.stage, L.MAX_STAGE);
  });
  test("advanceOrder and resolveOrder do not mutate the original", () => {
    const o = L.createOrder(byId(L.createProducts(), "rice"), "S");
    L.advanceOrder(o); L.resolveOrder(o, "refund"); eq(o.stage, 2); eq(o.resolution, null);
  });
  test("resolveOrder ignores unknown types and null orders", () => {
    eq(L.resolveOrder(null, "refund"), null);
    const o = L.createOrder(byId(L.createProducts(), "rice"), "S"); eq(L.resolveOrder(o, "bogus"), o);
  });
  test("orderStatus covers none, reserved, backup, delivered and resolved", () => {
    const p = byId(L.createProducts(), "rice"); const o = L.createOrder(p, "S");
    eq(L.orderStatus(null).text, "No active order"); eq(L.orderStatus(o).badge, "green");
    eq(L.orderStatus(L.createOrder(p, L.BACKUP_STORE)).badge, "blue");
    eq(L.orderStatus({ ...o, stage: 4 }).text.startsWith("Delivered"), true);
    eq(L.orderStatus(L.resolveOrder(o, "refund")).text.startsWith("Refund"), true);
  });
  test("demandPlan ranks pre-booked and low-stock items first", () => {
    const plan = L.demandPlan(L.createProducts(), { rice: 3 });
    eq(plan[0].id, "rice"); eq(plan[0].prepare, 8); eq(plan.length, 3);
  });

  // --- persistence ---
  const fakeStorage = () => { const m = {}; return { setItem: (k, v) => { m[k] = v; }, getItem: (k) => (k in m ? m[k] : null) }; };
  test("state survives a save/load round trip", () => {
    const s = fakeStorage(); const ps = L.createProducts(); L.reserveStock(ps, "rice", 2);
    const order = L.createOrder(byId(ps, "rice"), "S");
    ok(L.saveState(s, L.snapshotOf(ps, { order, reserved: { rice: 2 }, events: 7 })));
    const fresh = L.createProducts(); const r = L.restoreState(fresh, L.loadState(s));
    eq(byId(fresh, "rice").stock, 10); eq(r.order.stage, 2); eq(r.reserved, { rice: 2 }); eq(r.events, 7);
  });
  test("loadState/saveState survive blocked or corrupted storage", () => {
    eq(L.loadState(null), null); eq(L.saveState(null, {}), false);
    eq(L.loadState({ getItem: () => "{not json" }), null);
  });
  test("restoreState ignores invalid saved values", () => {
    const ps = L.createProducts();
    const r = L.restoreState(ps, { stock: { rice: { stock: -5 } }, order: { id: 1, stage: 99 }, reserved: { rice: "x", milk: 2 }, events: "9" });
    eq(byId(ps, "rice").stock, 12); eq(r.order, null); eq(r.reserved, { milk: 2 }); eq(r.events, 0);
  });


  // --- trust data, assisted orders, community stats ---
  test("every product carries traceability data (batch + best-before)", () =>
    L.createProducts().forEach(p => { ok(/^BAT-/.test(p.batch), p.id); ok(p.bestBefore.length > 3, p.id); }));
  test("availabilityInfo warns when stock is low and reflects backup availability", () => {
    const ps = L.createProducts();
    ok(L.availabilityInfo(byId(ps, "milk")).detail.startsWith("Only 4 left"));
    ok(!L.availabilityInfo(byId(ps, "rice")).detail.includes("Only"));
    ok(L.availabilityInfo(byId(ps, "honey")).detail.includes("partner store"));
    for (let i = 0; i < 6; i++) L.reserveBackup(ps, "honey");
    ok(L.availabilityInfo(byId(ps, "honey")).detail.startsWith("No nearby"));
  });
  test("createOrder stores the assisted customer and defaults to none", () => {
    const p = byId(L.createProducts(), "rice");
    eq(L.createOrder(p, "S").customer, null);
    eq(L.createOrder(p, "S", L.ORDER_ID, "Ravi, Rythu Nagar").customer, "Ravi, Rythu Nagar");
  });
  test("assisted order survives a save/load round trip", () => {
    const s = fakeStorage(); const ps = L.createProducts();
    const order = L.createOrder(byId(ps, "rice"), "S", L.ORDER_ID, "Ravi, Rythu Nagar");
    L.saveState(s, L.snapshotOf(ps, { order, assisted: 3 }));
    const r = L.restoreState(L.createProducts(), L.loadState(s));
    eq(r.order.customer, "Ravi, Rythu Nagar"); eq(r.assisted, 3);
  });
  test("restoreState ignores an invalid assisted counter", () => eq(L.restoreState(L.createProducts(), { assisted: -2 }).assisted, 0));
  test("communityStats starts at the seeded baseline and grows with assisted orders", () => {
    eq(L.communityStats(), { assisted: 28, fulfilled: 24, awaiting: 4 });
    eq(L.communityStats(2), { assisted: 30, fulfilled: 24, awaiting: 6 });
    eq(L.communityStats(-5).assisted, 28);
  });
  test("bookableProducts includes in-stock items and items covered by backup stock", () => {
    const ps = L.createProducts();
    eq(L.bookableProducts(ps).map(p => p.id), ["rice", "milk", "honey"]);
    for (let i = 0; i < 6; i++) L.reserveBackup(ps, "honey");
    eq(L.bookableProducts(ps).map(p => p.id), ["rice", "milk"]);
  });


  // --- reserveAny, order summary, HQ metrics, Google links ---
  test("reserveAny uses the main store first and the backup store only when needed", () => {
    const ps = L.createProducts();
    const main = L.reserveAny(ps, "rice"); ok(main.ok); eq(main.backup, false); eq(main.store, "Sri Lakshmi Store"); eq(byId(ps, "rice").stock, 11);
    const backup = L.reserveAny(ps, "honey"); ok(backup.ok); eq(backup.backup, true); eq(backup.store, L.BACKUP_STORE);
  });
  test("reserveAny reports unknown ids, bad input and exhausted backup stock", () => {
    const ps = L.createProducts();
    eq(L.reserveAny(ps, "nope").reason, "not_found");
    for (let i = 0; i < 6; i++) L.reserveAny(ps, "honey");
    eq(L.reserveAny(ps, "honey").reason, "no_backup");
  });
  test("orderSummary lists id, item, store, status and the assisted customer", () => {
    const o = L.createOrder(byId(L.createProducts(), "rice"), "S", L.ORDER_ID, "Ravi, Rythu Nagar");
    const lines = L.orderSummary(o).split("\n");
    eq(lines.length, 5); ok(lines[0].includes(L.ORDER_ID)); ok(lines[3].startsWith("Status: Reserved")); eq(lines[4], "Customer: Ravi, Rythu Nagar");
    eq(L.orderSummary(null), "");
  });
  test("hqMetrics totals pre-bookings and ignores invalid counters", () => {
    eq(L.hqMetrics({ reserved: { rice: 2, milk: 1, bad: -4, x: "z" }, rescued: 3, assisted: 1.5 }), { prebooked: 3, rescued: 3, assisted: 0 });
    eq(L.hqMetrics(), { prebooked: 0, rescued: 0, assisted: 0 });
  });
  test("restoreState round-trips the rescued counter", () => {
    const s = fakeStorage(); L.saveState(s, L.snapshotOf(L.createProducts(), { rescued: 4 }));
    eq(L.restoreState(L.createProducts(), L.loadState(s)).rescued, 4);
    eq(L.restoreState(L.createProducts(), { rescued: "x" }).rescued, 0);
  });
  test("mapsDirectionsUrl and gmailComposeUrl build keyless, encoded Google links", () => {
    const d = L.mapsDirectionsUrl("Sri Lakshmi Store & Co");
    ok(d.startsWith("https://www.google.com/maps/dir/?api=1&destination=")); ok(d.endsWith("Sri%20Lakshmi%20Store%20%26%20Co"));
    const g = L.gmailComposeUrl({ subject: "Order #1", body: "a\nb" });
    ok(g.startsWith("https://mail.google.com/mail/?view=cm")); ok(g.includes("su=Order%20%231")); ok(g.endsWith("body=a%0Ab"));
    ok(L.gmailComposeUrl().includes("su=&body="));
  });
  test("low-stock boundary: 5 is Low, 6 is In stock", () => {
    const p = { stock: L.LOW_STOCK_LIMIT }; eq(L.stockLevel(p).label, "Low"); eq(L.stockLevel({ stock: L.LOW_STOCK_LIMIT + 1 }).label, "In stock");
  });
  test("saveState reports failure when storage throws (quota exceeded)", () =>
    eq(L.saveState({ setItem() { throw new Error("quota"); } }, { a: 1 }), false));
  test("esc is safe for null, undefined and objects", () => {
    eq(L.esc(null), "null"); eq(L.esc(undefined), "undefined"); ok(!L.esc({ toString: () => "<x>" }).includes("<"));
  });
  test("advanceOrder(null) is null and demandPlan works with no pre-bookings", () => {
    eq(L.advanceOrder(null), null); eq(L.demandPlan(L.createProducts()).every(r => r.booked === 0), true);
  });

  // --- views (pure templates, including XSS cases) ---
  const evil = { id: "x", name: "<img src=x onerror=alert(1)>", price: 1, stock: 3, store: "<b>S</b>", confidence: 90, eta: "1 min",
    batch: "<i>B</i>", bestBefore: "\"2027\"", backupStock: 2 };
  test("productCard escapes every product field (XSS)", () => {
    const html = V.productCard(evil);
    ok(!html.includes("<img src=x") && !html.includes("<b>S</b>")); ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  });
  test("stockRow, trustModal and bookingModal escape product fields", () => {
    ok(!V.stockRow(evil).includes("<img")); const trust = V.trustModal(evil, "<o>").html;
    ok(!trust.includes("<img") && !trust.includes("<i>B</i>") && !trust.includes("<o>"));
    ok(!V.bookingModal(evil).html.includes("<img")); ok(!V.bookingModal({ ...evil, stock: 0 }).html.includes("<img"));
  });
  test("productCard shows the right call to action for in-stock and unavailable items", () => {
    const ps = L.createProducts();
    ok(V.productCard(byId(ps, "rice")).includes(">Pre-book<")); ok(V.productCard(byId(ps, "honey")).includes(">Find backup<"));
  });
  test("bookingModal offers confirm, backup or a no-backup message", () => {
    const ps = L.createProducts();
    ok(V.bookingModal(byId(ps, "rice")).html.includes('id="confirm"')); ok(V.bookingModal(byId(ps, "honey")).html.includes('id="backup"'));
    const none = { ...byId(ps, "honey"), backupStock: 0 }; const html = V.bookingModal(none).html;
    ok(!html.includes('id="backup"') && html.includes("No nearby partner store"));
  });
  test("timelineItems marks exactly one current step with aria-current", () => {
    for (let stage = 0; stage < 4; stage++) eq((V.timelineItems(stage).match(/aria-current="step"/g) || []).length, 1);
    eq((V.timelineItems(4).match(/aria-current/g) || []).length, 0);
  });
  test("checkpointButtons are labelled, ordered and expose pressed state", () => {
    const html = V.checkpointButtons(2);
    eq((html.match(/aria-pressed="true"/g) || []).length, 2); eq((html.match(/aria-label="Checkpoint \d: /g) || []).length, 4);
  });
  test("assistModal lists bookable products and has labelled inputs plus an alert region", () => {
    const html = V.assistModal(L.bookableProducts(L.createProducts())).html;
    ["custName", "custVillage", "custProduct"].forEach(id => ok(new RegExp(`<label for="${id}"`).test(html), id));
    ok(html.includes('role="alert"')); eq((html.match(/<option /g) || []).length, 3); ok(html.includes("(backup store)"));
  });
  test("every static modal title is set and every modal button is type=button", () => {
    Object.values(V.STATIC_MODALS).forEach(m => { ok(m.title.length > 0); ok(!/<button(?![^>]*type="button")/.test(m.html)); });
    ok(V.helpModal().title.length > 0); ok(V.alternativesModal().html.includes("chooseAlt"));
    ok(V.planModal(L.demandPlan(L.createProducts())).html.includes("Prepare +"));
  });
  test("emptyProducts renders a helpful message and planRow shows the numbers", () => {
    ok(V.emptyProducts().includes("No product found")); ok(V.planRow({ name: "A", prepare: 8, booked: 3 }).includes("Prepare +8 (3 pre-booked)"));
  });
  test("NovaViews API and CHECKPOINTS are frozen", () => { ok(Object.isFrozen(V)); ok(Object.isFrozen(V.CHECKPOINTS)); ok(Object.isFrozen(V.STATIC_MODALS)); });

  // --- role switching ---
  test("nextRole cycles through all roles and wraps", () => {
    let r = "Customer"; const seen = [];
    for (let i = 0; i < 4; i++) { r = L.nextRole(r).name; seen.push(r); }
    eq(seen, ["Community Store", "Partner Store", "HQ", "Customer"]);
  });
  test("nextRole starts from Customer for unknown names", () => eq(L.nextRole("???").name, "Customer"));
  test("every role points to a section id", () => L.ROLES.forEach(r => ok(r.section.length > 0)));

  // --- integration / accessibility checks (Node only: reads the real project files) ---
  if (isNode) {
    const fs = require("fs");
    const html = fs.readFileSync(__dirname + "/index.html", "utf8");
    const read = (f) => fs.readFileSync(__dirname + "/" + f, "utf8");
    const app = read("app.js") + read("logic.js") + read("views.js");
    test("every #id used in app.js exists in index.html", () => {
      const used = [...app.matchAll(/\$\("#([\w-]+)"\)/g)].map(m => m[1]);
      const missing = [...new Set(used)].filter(id => !html.includes(`id="${id}"`));
      eq(missing, []);
    });
    test("index.html declares lang and viewport", () => { ok(/<html[^>]*lang=/.test(html)); ok(html.includes('name="viewport"')); });
    test("search input has an associated label", () => ok(/<label for="q"/.test(html)));
    test("notice area is an aria-live status region", () => ok(/id="notice"[^>]*role="status"[^>]*aria-live="polite"/.test(html)));
    test("index.html loads app.js with defer", () => ok(/<script src="app.js" defer>/.test(html)));
    test("Google Maps and Calendar controls exist in the page", () =>
      ["showMap", "maps", "calendar", "mapBox"].forEach(id => ok(html.includes(`id="${id}"`), id)));
    test("every role section id exists in index.html", () => L.ROLES.forEach(r => ok(html.includes(`id="${r.section}"`), r.section)));
    test("close button and dialog are labelled for screen readers", () => {
      ok(/id="close"[^>]*aria-label=/.test(html)); ok(/<dialog[^>]*aria-labelledby="modalTitle"/.test(html));
    });
    test("skip link and live product region exist", () => { ok(html.includes('href="#content"')); ok(/id="products"[^>]*aria-live/.test(html)); });
    test("case evidence section maps problems to features", () => ok(html.includes("29%") && html.includes("Pre-book + stock lock")));
    test("source files keep readable line lengths (<=160 chars)", () => {
      ["logic.js", "views.js", "app.js", "tests.js", "styles.css", "sw.js"].forEach(f => fs.readFileSync(__dirname + "/" + f, "utf8").split("\n")
        .forEach((line, i) => ok(line.length <= 160, `${f}:${i + 1} is ${line.length} chars`)));
    });
    test("every button action id in app.js has a matching modal button", () => {
      const ids = [...app.matchAll(/modalButton\("(\w+)"/g)].map(m => m[1]).concat(["confirm", "backup"]);
      const handlers = app.match(/const ACTIONS = \{([\s\S]*?)\n  \};/)[1];
      ids.forEach(id => ok(new RegExp("\\b" + id + "\\b").test(handlers), `no handler for ${id}`));
    });
    test("stock panel is data-driven (no hardcoded stock rows in HTML)", () => ok(html.includes('id="stockList"') && !html.includes("12 available")));
    test("assisted form has validation hooks", () => ok(/aria-invalid/.test(app) && /role="alert"/.test(app)));
    test("package.json defines test and lint scripts", () => {
      const pkg = JSON.parse(fs.readFileSync(__dirname + "/package.json", "utf8")); ok(pkg.scripts.test && pkg.scripts.lint);
    });
    test("index.html loads logic.js before app.js", () => ok(html.indexOf("logic.js") > -1 && html.indexOf("logic.js") < html.indexOf("app.js")));
    test("tracking and demand lists are rendered from state (no hardcoded rows)", () =>
      ok(html.includes('id="checkpoints"') && html.includes('id="demandList"') && !html.includes("Prepare +6")));
    test("logic.js has no DOM access", () => {
      const code = fs.readFileSync(__dirname + "/logic.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      ok(!/document\.|window\./.test(code));
    });
    const sw = fs.readFileSync(__dirname + "/sw.js", "utf8");
    const manifest = JSON.parse(fs.readFileSync(__dirname + "/manifest.json", "utf8"));
    test("Content-Security-Policy blocks inline scripts and restricts framing to Google", () => {
      const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
      ok(/script-src 'self'/.test(csp) && !/unsafe-inline|unsafe-eval/.test(csp), "script-src");
      ok(csp.includes("frame-src https://www.google.com") && csp.includes("object-src 'none'"), "frame/object");
    });
    test("page has no inline scripts or inline event handlers (CSP-safe)", () => {
      ok(!/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html), "inline script");
      ok(!/\son\w+="/.test(html), "inline handler");
    });
    test("map iframe is sandboxed and external links never leak the opener", () => {
      ok(/frame\.setAttribute\("sandbox"/.test(app));
      const opens = (app.match(/window\.open\(/g) || []).length;
      ok(opens > 0 && (app.match(/"noopener,noreferrer"/g) || []).length === opens, "every window.open needs noopener,noreferrer");
    });
    test("manifest declares icons, scope and a start_url that exist", () => {
      ok(manifest.icons.length > 0 && manifest.scope && manifest.start_url);
      manifest.icons.forEach(i => ok(fs.existsSync(__dirname + "/" + i.src), i.src));
    });
    test("service worker precaches every file the page loads", () => {
      ["index.html", "styles.css", "logic.js", "views.js", "app.js", "manifest.json", "icon.svg"].forEach(f => ok(sw.includes(`"${f}"`), f));
    });
    test("timeline is an ordered list with aria-current on the active step", () => {
      ok(/<ol id="timeline"[^>]*aria-label=/.test(html)); ok(app.includes("aria-current"));
    });
    test("role switcher label names the current role (label-in-name)", () => ok(/id="role"[^>]*aria-label="[^"]*Customer/.test(html)));
    test("role button stays visible on small screens", () => ok(!/\.role\s*\{\s*display:\s*none/.test(fs.readFileSync(__dirname + "/styles.css", "utf8"))));
    test("buttons meet a 44px minimum touch target and reduced motion is honoured", () => {
      const css = fs.readFileSync(__dirname + "/styles.css", "utf8");
      ok(/min-height:\s*44px/.test(css)); ok(/prefers-reduced-motion/.test(css)); ok(app.includes("prefers-reduced-motion"));
    });
    test("lookups of handler tables are prototype-safe", () => ok(app.includes("Object.hasOwn(ACTIONS") && app.includes("Object.hasOwn(MODALS")));
    test("community stats are rendered from state (ids exist in HTML)", () =>
      ["statAssisted", "statFulfilled", "statAwaiting", "orderTitle", "orderMeta"].forEach(id => ok(html.includes(`id="${id}"`), id)));
    test("repository hygiene files exist (README, CI, editorconfig, gitignore)", () => {
      ["README.md", ".github/workflows/ci.yml", ".editorconfig", ".gitignore"].forEach(f => ok(fs.existsSync(__dirname + "/" + f), f));
    });
    const logicSrc = read("logic.js"), viewsSrc = read("views.js"), appSrc = read("app.js"), testSrc = read("tests.js");
    test("every public NovaLogic and NovaViews function is exercised by a test", () => {
      const fns = (api) => Object.keys(api).filter(name => typeof api[name] === "function");
      const untested = fns(L).concat(fns(V)).filter(name => !new RegExp("[LV]\\." + name + "\\b").test(testSrc));
      eq(untested, []);
    });
    test("views.js has no DOM access and app.js is the only file that touches the document", () => {
      ok(!/document\.|window\./.test(viewsSrc.replace(/\/\*[\s\S]*?\*\//g, "")));
      ok(!/document\.|window\./.test(logicSrc.replace(/\/\*[\s\S]*?\*\//g, "")));
    });
    test("app.js uses a single delegated click listener and no inline handlers", () => {
      eq((appSrc.match(/addEventListener\("click"/g) || []).length, 2); // document (delegated) + dialog backdrop
      ok(!/\.onclick\s*=|\.oninput\s*=/.test(appSrc));
    });
    test("app.js writes to storage in batches and flushes on page hide", () => ok(/PERSIST_DELAY_MS/.test(appSrc) && /pagehide/.test(appSrc)));
    test("app.js keeps functions short (<= 40 lines each)", () => {
      const lines = appSrc.split("\n"); let start = -1, name = "";
      lines.forEach((line, i) => {
        const m = line.match(/^ {2}(?:async )?function (\w+)/);
        if (m) { start = i; name = m[1]; }
        else if (start >= 0 && /^ {2}\}/.test(line)) { ok(i - start <= 40, `${name} is ${i - start} lines`); start = -1; }
      });
    });
    test("every section landmark is labelled by its heading", () => {
      const sections = html.match(/<section [^>]*>/g) || [];
      sections.forEach(s => { const m = s.match(/aria-labelledby="(\w+)"/); ok(m && html.includes(`id="${m[1]}"`), s); });
    });
    test("HQ live impact counters and new Google buttons exist in the page", () =>
      ["hqPrebooked", "hqRescued", "hqAssisted", "directions", "email"].forEach(id => ok(html.includes(`id="${id}"`), id)));
    test("index.html loads views.js between logic.js and app.js", () => {
      const a = html.indexOf("logic.js"), b = html.indexOf("views.js"), c = html.indexOf('src="app.js"'); ok(a > -1 && a < b && b < c);
    });
    test("project documents its architecture and licence", () => {
      ["ARCHITECTURE.md", "LICENSE", "eslint.config.js", ".prettierrc.json"].forEach(f => ok(fs.existsSync(__dirname + "/" + f), f));
    });
    test("no eval or document.write in app code", () => ok(!/\beval\(|document\.write\(/.test(app)));
    test("external window.open uses noopener", () => ok(/noopener/.test(app)));
  }

  // --- report ---
  const passed = results.filter(r => r.pass).length;
  const summary = `${passed}/${results.length} tests passed`;
  if (typeof document !== "undefined") {
    document.getElementById("results").innerHTML = results.map(r =>
      `<li>${r.pass ? "PASS" : "FAIL"} — ${L.esc(r.name)}${r.detail ? ` (${L.esc(r.detail)})` : ""}</li>`).join("");
    document.getElementById("summary").textContent = summary;
  } else {
    results.forEach(r => console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  -> " + r.detail : ""}`));
    console.log("\n" + summary);
    if (passed !== results.length) process.exitCode = 1;
  }
})();
