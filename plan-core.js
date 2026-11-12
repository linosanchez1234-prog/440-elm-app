/* Calendar rules are evaluated locally, using calendar dates rather than elapsed hours (2026-11-12). */
(function (root) {
  "use strict";
  const defaults = {
    linenWarning: 10,
    linenUrgent: 5,
    generalWarning: 7,
    generalUrgent: 5,
    hardDays: 2,
    laundryDays: 2,
  };
  const phases = {
    "": "No phase",
    prep: "Prep",
    hard: "Hard setup",
    linens: "Linens",
    tables: "Table setup",
    breakdown: "Breakdown",
  };
  const scheduleFields = [
    "loadInDate",
    "loadInTime",
    "loadInTimeEnd",
    "loadInConfirmed",
    "loadOutDate",
    "loadOutTime",
    "loadOutTimeEnd",
    "loadOutConfirmed",
  ];
  const day = (s) =>
    /^\d{4}-\d{2}-\d{2}/.test(s || "")
      ? Date.parse(s.slice(0, 10) + "T12:00:00Z")
      : NaN;
  const add = (s, n) =>
    Number.isFinite(day(s))
      ? new Date(day(s) + n * 86400000).toISOString().slice(0, 10)
      : "";
  const date = (s) =>
    Number.isFinite(day(s))
      ? new Date(day(s)).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })
      : "Date not known";
  function time(s) {
    if (!s) return "";
    const m = /^(\d{1,2}):(\d{2})$/.exec(s);
    return m
      ? (+m[1] % 12 || 12) + ":" + m[2] + (+m[1] < 12 ? " AM" : " PM")
      : s;
  }
  const clock = (s) => {
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(s || "");
    if (!m) return "23:59";
    let h = +m[1];
    if (m[3]) h = (h % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
    return String(h).padStart(2, "0") + ":" + m[2];
  };
  const windowText = (v, k) =>
    [
      date(v[k + "Date"]),
      [time(v[k + "Time"]), time(v[k + "TimeEnd"])]
        .filter(Boolean)
        .join(" to "),
    ]
      .filter(Boolean)
      .join(", ");
  const vendor = (v) =>
    Object.assign(
      { kind: "other", needsPresence: !["linen", "laundry"].includes(v.kind) },
      v,
    );
  function shiftWarnings(e, rules = {}, blocks = []) {
    const r = { ...defaults, ...rules },
      out = [],
      d = e.date || e.event?.date;
    const linens = (e.vendors || []).filter((v) => v.kind === "linen");
    (e.staffing?.shifts || e.shifts || []).forEach((sh) => {
      if (!sh.start) return;
      const push = (text) =>
        out.push({
          key: "shift:" + sh.n + ":" + out.length,
          text,
          level: "soon",
          dueDate: sh.start.slice(0, 10),
          shift: sh.n,
        });
      if (sh.phase === "hard" && sh.start.slice(0, 10) < add(d, -r.hardDays))
        push(
          "Hard setup is planned before " +
            date(add(d, -r.hardDays)) +
            ", the earliest day allowed.",
        );
      if (["hard", "linens", "tables"].includes(sh.phase))
        blocks.forEach((b) => {
          if (
            sh.start.slice(0, 10) >= b.start &&
            sh.start.slice(0, 10) <= (b.end || b.start)
          )
            push("The venue is booked for " + b.label + " that day.");
        });
      if (["linens", "tables"].includes(sh.phase)) {
        if (linens.some((v) => !v.loadInDate))
          push("Linen delivery date is not known yet.");
        linens
          .filter((v) => v.loadInDate)
          .sort((a, b) =>
            (
              b.loadInDate +
              "T" +
              clock(b.loadInTimeEnd || b.loadInTime)
            ).localeCompare(
              a.loadInDate + "T" + clock(a.loadInTimeEnd || a.loadInTime),
            ),
          )
          .slice(0, 1)
          .forEach((v) => {
            const stamp =
              v.loadInDate + "T" + clock(v.loadInTimeEnd || v.loadInTime);
            if (sh.start < stamp)
              push(
                "Linens arrive " +
                  windowText(v, "loadIn") +
                  ", after this shift starts.",
              );
          });
      }
    });
    return out;
  }
  function attention(e, today, rules = {}, blocks = []) {
    const r = { ...defaults, ...rules },
      d = e.date || e.event?.date,
      c = e.confirm || {},
      out = [],
      days = (day(d) - day(today)) / 86400000;
    const push = (key, text, linen = false, dueDate = d) =>
      out.push({
        key,
        text,
        level:
          days <= (linen ? r.linenUrgent : r.generalUrgent)
            ? "urgent"
            : days <= (linen ? r.linenWarning : r.generalWarning)
              ? "soon"
              : "info",
        dueDate,
      });
    if (!Number.isFinite(days)) return out;
    if (days >= 0) {
      (e.vendors || []).forEach((raw) => {
        const v = vendor(raw);
        ["loadIn", "loadOut"].forEach((k) => {
          const label = k === "loadIn" ? "delivery" : "pickup";
          if (!v[k + "Date"] || !v[k + "Confirmed"])
            push(
              "vendor:" + v.n + ":" + k,
              (v.name || "Vendor") +
                " " +
                label +
                ": " +
                (!v[k + "Date"] ? "date needed" : "not confirmed"),
              v.kind === "linen",
            );
          const receiver = e.staffing?.receivers?.[v.n + ":" + k];
          if (v.needsPresence && !(receiver?.person && receiver?.shiftId)) {
            push(
              "coverage:" + v.n + ":" + k,
              "Assign a receiver for " + (v.name || "vendor") + " " + label,
            );
            out[out.length - 1].level =
              days <= 5 ? "urgent" : days <= r.generalWarning ? "soon" : "info";
          }
        });
      });
      [
        ["guestCount", "Confirm final guest count"],
        ["floorPlan", "Confirm floor plan and table counts"],
        ["rentals", "Confirm what is being rented"],
      ].forEach(([k, t]) => {
        if (!c[k]?.confirmed) push("confirm:" + k, t);
      });
      Object.values(e.questions || {})
        .filter((q) => q.status === "waiting")
        .forEach((q) => push("question:" + q.id, q.text));
      out.push(...shiftWarnings(e, r, blocks));
    }
    if (!c.laundry?.requested)
      out.push({
        key: "laundry",
        text: "Request laundry pickup for " + date(add(d, r.laundryDays)),
        level: days <= 0 ? "urgent" : "info",
        dueDate: add(d, r.laundryDays),
      });
    return out.sort(
      (a, b) =>
        ({ urgent: 0, soon: 1, info: 2 })[a.level] -
          { urgent: 0, soon: 1, info: 2 }[b.level] ||
        a.dueDate.localeCompare(b.dueDate),
    );
  }
  root.ElmPlan = {
    defaults,
    phases,
    scheduleFields,
    day,
    add,
    date,
    time,
    windowText,
    vendor,
    attention,
    shiftWarnings,
  };
  if (typeof module !== "undefined") module.exports = root.ElmPlan;
})(typeof window === "undefined" ? globalThis : window);
