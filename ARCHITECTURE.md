# Architecture

NOVA Smart Local is a dependency-free, three-layer browser app. Each layer only knows about the one below it.

```
index.html / styles.css        static page + styles (strict CSP, semantic landmarks)
        │
app.js    controller           DOM events -> state changes -> re-render. The only file that touches the document.
        │
views.js  templates            pure functions: data in, escaped HTML string out (unit-tested for XSS)
        │
logic.js  business rules       pure functions: stock locking, backup store, orders, demand plan, persistence, Google links
```

## Data flow (INPUT -> LOGIC -> ACTION -> OUTPUT)

1. **Input** - search box, Pre-book, Community Store form, partner "Sell 1", checkpoint buttons.
2. **Logic** - `reserveStock` / `reserveBackup` / `reserveAny` lock stock and never go negative; `demandPlan` turns pre-bookings
   into preparation advice; `hqMetrics` and `communityStats` aggregate what happened.
3. **Action** - `app.js` stores the new `Order`, updates counters and calls `refreshAll()`.
4. **Output** - `views.js` renders product cards, the stock panel, timeline, checkpoints and HQ counters from the same data,
   so the customer, partner-store and HQ views cannot disagree.

## Design decisions

- **Single delegated click listener.** `CLICK_RULES` (selector -> handler) and `ACTIONS` (button id -> handler) replace dozens
  of per-element handlers: fewer listeners, one place to read every user action.
- **Skip unchanged DOM writes.** `setHtml` compares the new markup with the last one written to that panel.
- **Batched persistence.** State is saved at most once per 250 ms and flushed on `pagehide`.
- **Immutable orders.** `advanceOrder` / `resolveOrder` return copies, so tests and UI never share mutable order state.
- **Safe by construction.** Every dynamic value passes through `esc()`; a CSP forbids inline scripts; the Google Maps iframe is
  sandboxed; external links use `noopener,noreferrer`; saved state is sanitised on load (`restoreState`).
- **Offline-first assets.** `sw.js` pre-caches the app shell (http/https only) for low-connectivity villages.

## Google services (no API keys)

| Service | Where | Function |
| --- | --- | --- |
| Maps embed | Local tracking card | `mapsEmbedUrl` (lazy-loaded, sandboxed iframe) |
| Maps search | Local tracking card | `mapsSearchUrl` |
| Maps directions | Local tracking card | `mapsDirectionsUrl` |
| Calendar | Local tracking card | `calendarUrl` |
| Gmail compose | Local tracking card | `gmailComposeUrl` + `orderSummary` |

## Testing

`npm test` (or open `tests.html`) runs the unit tests for `logic.js` and `views.js`; in Node it also checks the real HTML/CSS/JS
files (CSP, labels, ARIA, wiring, function length, API coverage). CI runs `npm run check` on every push.
