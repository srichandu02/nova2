# NOVA SMART LOCAL — PromptWars Business Rescue Challenge Prototype

## Problem selected
The prototype focuses on **order reliability driven by inaccurate availability and fragmented local-store operations**.

Case evidence used:
- 29%: products shown available become unavailable after ordering.
- 35% of cancellations: product unavailable.
- 18% of cancellations: store rejected the order.
- 13%: deliveries arrive >15 minutes late.
- 6%: orders require refund/support interaction.
- 39% of partner stores say online inventory takes too much effort.
- 28% struggle to predict online demand.
- 23% sometimes reject orders during busy periods.

## Product
NOVA Smart Local is a reliability layer connecting customer, Community Store, partner store and HQ.

### Core functional journey
INPUT → PROCESSING/LOGIC → ACTION/RECOMMENDATION → OUTPUT

1. Customer searches for a product.
2. System checks demo stock and availability confidence.
3. Customer pre-books and stock is reserved.
4. If unavailable, system recommends a nearby partner store.
5. Community Store can place the order for customers needing assistance (reserves real stock, or backup stock, and starts tracking).
6. Local checkpoints update tracking.
7. Replacement / alternative / refund is handled through one flow.
8. Store receives demand preparation recommendations.
9. HQ sees business metrics, live session impact (pre-bookings, orders rescued by a backup store, assisted orders) and impact logic.

## Features from team idea
- Pre-booking to reduce product unavailability.
- Partner with local/community stores.
- Community Store assisted ordering for low app/internet dependency.
- Customer trust: source, batch, expiry and customer/order traceability.
- Local checkpoint tracking for better accuracy.
- Replacement before refund when appropriate.
- Alternative local store fulfillment.
- Worker shift planning for peak hours.
- Pre-order demand signals.
- Experience rewards such as movie/dining/travel offers instead of relying only on confusing coupons.
- Proposed 15-order dinner reward is clearly labelled as a proposed rule.
- Protected customer contact workflow.
- HQ control center.

## Challenge compliance
The supplied challenge says a static UI is not enough; the prototype must demonstrate meaningful functionality. This build contains real client-side interactions for search, pre-booking, backup-store reservation, stock updates, assisted ordering, tracking checkpoints, replacement/alternative/refund flows, demand preparation, KPI events and a Google Maps navigation link.

It also reflects the evaluation areas shown in the event notes:
- Code quality: three clear layers (`logic.js` rules, `views.js` templates, `app.js` controller), JSDoc types, short functions (enforced by a test), one delegated click listener, ESLint/Prettier configs, see `ARCHITECTURE.md`.
- Security: user text is escaped; strict Content-Security-Policy (no inline scripts, framing limited to Google Maps); sandboxed map iframe; `noopener,noreferrer` on external links; prototype-safe handler lookups; no eval; no API secrets; protected-call concept; production authorization still required.
- Efficiency: no framework/dependency requirement; DOM updates are skipped when output is unchanged; the map loads only on request; a service worker caches the app for low-connectivity villages (served over http/https).
- Testing/validation: 120+ automated tests (`npm test` or open `tests.html`) cover business rules, rendered HTML (including XSS cases), persistence, CSP, accessibility markers and file wiring; CI runs them on every push.
- Accessibility: semantic landmarks, skip link, labelled form fields with inline `aria-invalid` errors, ordered-list timeline with `aria-current`, live status announcements, visible focus, 44px touch targets, Enter-to-search, backdrop/Esc dialog close, reduced-motion support, responsive layout (role switcher stays available on phones).
- Problem statement alignment: each core feature maps to case evidence.
- Google services usage: embedded Google Maps view of the nearby store, Google Maps directions, a Google Calendar delivery reminder and a Gmail order-summary draft. None need an API key.

## Project structure
```
index.html  styles.css                 # page + styles
logic.js                               # pure business logic (no DOM, unit tested)
views.js                               # pure HTML templates (escaped, unit tested)
app.js                                 # controller (events, state, rendering)
tests.js    tests.html                 # automated tests (Node or browser)
manifest.json  icon.svg  sw.js         # PWA metadata, icon, offline cache
package.json                           # `npm test`, `npm run check`
.github/workflows/ci.yml               # runs tests on every push
```

## Run tests
```
npm test        # or: node tests.js   (no install needed)
```
Or open `tests.html` in a browser. `logic.js` holds pure business logic (stock, backup store, orders, demand plan, persistence); `views.js` builds escaped HTML; `app.js` is the controller.

## Run
Open `index.html` in a modern browser (or serve the folder, e.g. `python3 -m http.server`, to enable the offline cache).

No build step or npm install is required.

## Demo order
1. Start order.
2. Search "rice".
3. Click Pre-book.
4. Confirm reservation.
5. Open tracking.
6. Go to Community Store, create an assisted booking, and watch the stats and order panel update.
7. Go to Partner Store and click "Sell 1" on any product to show stock sync with the customer view.
8. Create demand preparation plan.
9. Open Control Center and explain the business impact chain.

## State and persistence
Reservations, backup-store stock, order tracking, demand plan and KPI events are real state. The session is saved in
`localStorage` (safe if blocked) and survives a refresh; use **Reset demo** in the header to start over.

## Important
Numbers labelled "case baseline" come from the supplied challenge brief. Product inventory, availability confidence, delivery times, rewards and operational recommendations are demo/proposed values, not claims about a real NOVA CART system.
