"use strict";
const assert = require("node:assert/strict"),
  P = require("../plan-core.js");
const event = {
  date: "2026-12-18",
  vendors: [{ n: 1, name: "Linen company", kind: "linen" }],
};
const level = (day, kind = "linen") =>
  P.attention({ ...event, vendors: [{ ...event.vendors[0], kind }] }, day).find(
    (i) => i.key === "vendor:1:loadIn",
  ).level;
assert.equal(level("2026-12-07"), "info");
assert.equal(level("2026-12-08"), "soon");
assert.equal(level("2026-12-13"), "urgent");
assert.equal(level("2026-12-11", "other"), "soon");
assert.equal(level("2026-12-13", "other"), "urgent");
for (const [start, n] of [
  ["2026-12-15T09:00", 1],
  ["2026-12-16T09:00", 0],
])
  assert.equal(
    P.shiftWarnings({
      date: event.date,
      shifts: [{ n: 1, phase: "hard", start }],
    }).length,
    n,
  );
const laundry = P.attention(event, "2026-12-18").find(
  (i) => i.key === "laundry",
);
assert.match(laundry.text, /Dec 20/);
assert.equal(laundry.level, "urgent");
assert.equal(P.vendor({ kind: "linen" }).needsPresence, false);
assert.equal(P.vendor({ kind: "other" }).needsPresence, true);
assert.equal(
  P.vendor({ kind: "linen", needsPresence: true }).needsPresence,
  true,
);
assert.equal(P.attention(event, "2026-12-19").length, 1);
assert.equal(
  P.attention(
    { ...event, confirm: { laundry: { requested: true } } },
    "2026-12-19",
  ).length,
  0,
);
assert.equal(
  P.shiftWarnings({
    date: event.date,
    vendors: [{ kind: "linen" }],
    shifts: [{ n: 1, phase: "linens", start: "2026-12-17T09:00" }],
  }).length,
  1,
);
assert.equal(
  P.shiftWarnings(
    {
      date: event.date,
      vendors: [
        { kind: "linen", loadInDate: "2026-12-17", loadInTime: "10:00" },
      ],
      shifts: [{ n: 1, phase: "tables", start: "2026-12-17T09:00" }],
    },
    {},
    [{ start: "2026-12-17", label: "Venue booking" }],
  ).length,
  2,
);
assert.equal(P.add("2026-12-31", 2), "2027-01-02");
assert.equal(P.add("2026-03-08", 2), "2026-03-10");
console.log("Attention and setup order checks passed.");
