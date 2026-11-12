/* One calendar for saved events, vendor visits and planned shifts (2026-11-12). */
(function () {
  "use strict";
  const C = ElmCloud,
    P = ElmPlan,
    U = ElmPlanUI,
    E = U.esc,
    $ = (id) => document.getElementById(id);
  let user,
    events = [],
    blocks = [],
    roster = [],
    rules = { ...P.defaults },
    selected = "",
    month = new Date().toLocaleDateString("en-CA").slice(0, 7),
    busy = false;
  const today = () => {
    const d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  };
  month = today().slice(0, 7);
  const owner = () => user?.role === "owner",
    message = (s) => ($("message").textContent = s || ""),
    parse = (s, f) => {
      try {
        return JSON.parse(s);
      } catch {
        return f;
      }
    };
  function by() {
    if (owner()) return "owner";
    let n = localStorage.getItem("elm-planner-name") || "";
    if (!n.trim()) {
      n = prompt("Your name, to record with your changes") || "";
      if (!n.trim()) throw Error("Enter your name before making changes.");
      localStorage.setItem("elm-planner-name", n.trim());
    }
    return n.trim();
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    message("");
    try {
      await fn();
    } catch (e) {
      message(e.message);
    } finally {
      busy = false;
    }
  }
  async function refresh() {
    const [list, bs, rs, settings] = await Promise.all([
      C.listEvents(false),
      C.listBlocks(),
      C.getSetting("roster"),
      C.getSetting("rules"),
    ]);
    blocks = bs;
    roster = rs.people || [];
    rules = { ...P.defaults, ...settings };
    events = await Promise.all(
      list.map(async (ev) => {
        const [v, c, q] = await Promise.all(
          ["vendors", "confirm", "questions"].map((k) =>
            C.getShared(ev.cloudId, k),
          ),
        );
        return {
          ...ev,
          vendors: U.rows(v),
          confirm: c,
          questions: q,
          staffing: {
            shifts: parse(ev.shiftsSummaryJson, []),
            receivers: parse(ev.receiversJson, {}),
          },
        };
      }),
    );
    render();
  }
  function attention(ev) {
    return P.attention(ev, today(), rules, blocks).filter(
      (i) => owner() || /^(vendor|confirm|question):/.test(i.key),
    );
  }
  function button(text, action, id = "") {
    return (
      '<button type="button" data-action="' +
      action +
      '" data-id="' +
      E(id) +
      '">' +
      E(text) +
      "</button>"
    );
  }
  function shiftText(s) {
    return (
      (s.label || "Shift") +
      ": " +
      P.date(s.start) +
      ", " +
      P.time((s.start || "").slice(11, 16)) +
      " to " +
      P.time((s.end || "").slice(11, 16)) +
      (s.phase ? " · " + P.phases[s.phase] : "") +
      (s.people ? " · " + s.people.split("\n").join(", ") : "")
    );
  }
  function render() {
    let groups = events
      .map((ev) => ({ ev, items: attention(ev) }))
      .filter((g) => g.items.length);
    groups.sort(
      (a, b) =>
        ({ urgent: 0, soon: 1, info: 2 })[a.items[0].level] -
          { urgent: 0, soon: 1, info: 2 }[b.items[0].level] ||
        a.ev.date.localeCompare(b.ev.date),
    );
    let html =
      "<section><h2>Attention</h2>" +
      groups
        .map(
          (g) =>
            "<article><h3>" +
            E(g.ev.client || g.ev.eventId || "Event") +
            " · " +
            E(P.date(g.ev.date)) +
            "</h3>" +
            g.items
              .map(
                (i) =>
                  '<p class="' +
                  i.level +
                  '">' +
                  button(i.text, "attention", g.ev.cloudId + "|" + i.key) +
                  " <span>" +
                  i.level +
                  "</span></p>",
              )
              .join("") +
            "</article>",
        )
        .join("") +
      (!groups.length ? "<p>Nothing needs attention.</p>" : "") +
      '</section><section><div class="toolbar">' +
      button("Previous month", "prev") +
      "<h2>" +
      E(
        new Date(month + "-15T12:00:00").toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        }),
      ) +
      "</h2>" +
      button("Next month", "next") +
      button("Today", "today") +
      (owner()
        ? button("Add event", "add-event") +
          button("Add venue booking", "add-block")
        : "") +
      '</div><div class="calendar">';
    const start = month + "-01",
      offset = new Date(start + "T12:00:00").getDay();
    html += '<div class="pad"></div>'.repeat(offset);
    for (let d = start; d.slice(0, 7) === month; d = P.add(d, 1)) {
      let entries = [];
      events.forEach((ev) => {
        if (ev.date === d)
          entries.push(
            button(ev.client || ev.eventId || "Event", "event", ev.cloudId),
          );
        ev.vendors.forEach((v) =>
          ["loadIn", "loadOut"].forEach((k) => {
            if (v[k + "Date"] === d)
              entries.push(
                button(
                  (v.name || "Vendor") +
                    " " +
                    (k === "loadIn" ? "delivery" : "pickup") +
                    " " +
                    P.time(v[k + "Time"]),
                  "event",
                  ev.cloudId,
                ),
              );
          }),
        );
        ev.staffing.shifts.forEach((s) => {
          if (s.start?.slice(0, 10) === d)
            entries.push(button(shiftText(s), "event", ev.cloudId));
        });
      });
      blocks
        .filter((b) => d >= b.start && d <= (b.end || b.start))
        .forEach((b) =>
          entries.push(
            owner()
              ? button("Venue booking: " + b.label, "block", b.id)
              : "<p>Venue booking: " + E(b.label) + "</p>",
          ),
        );
      html +=
        '<div class="day"><strong>' +
        E(P.date(d)) +
        "</strong>" +
        entries.join("") +
        (!entries.length ? '<span class="empty"></span>' : "") +
        "</div>";
    }
    html +=
      '</div></section><section id="eventPanel">' + panel() + "</section>";
    if (owner())
      html +=
        "<details><summary>Staff roster</summary>" +
        roster
          .map(
            (p) =>
              "<p>" +
              E(p.name) +
              (p.active ? "" : " (inactive)") +
              " " +
              button("Edit", "person", p.id) +
              "</p>",
          )
          .join("") +
        button("Add person", "person") +
        '</details><details><summary>Lead times and limits</summary><form id="rulesForm">' +
        Object.keys(P.defaults)
          .map((k) =>
            U.field(
              k,
              {
                linenWarning: "Linen first warning, days before",
                linenUrgent: "Linen urgent, days before",
                generalWarning: "Other first warning, days before",
                generalUrgent: "Other urgent, days before",
                hardDays: "Hard setup may start, days before",
                laundryDays: "Laundry pickup, days after",
              }[k],
              rules[k],
              "number",
            ),
          )
          .join("") +
        "<button>Save rules</button></form></details>";
    $("app").innerHTML = html;
    const f = $("rulesForm");
    if (f)
      f.onsubmit = (e) => {
        e.preventDefault();
        run(async () => {
          const next = {};
          new FormData(f).forEach((v, k) => {
            next[k] = Number(v);
            if (!Number.isInteger(next[k]) || next[k] < 0 || next[k] > 365)
              throw Error("Enter whole days from 0 to 365.");
          });
          if (
            next.linenWarning < next.linenUrgent ||
            next.generalWarning < next.generalUrgent
          )
            throw Error(
              "The first warning must come before the urgent warning.",
            );
          await C.setSetting("rules", next);
          await refresh();
        });
      };
  }
  function panel() {
    const ev = events.find((e) => e.cloudId === selected);
    if (!ev) return "<p>Select an event to see its schedule.</p>";
    return (
      "<h2>" +
      E(ev.client || ev.eventId || "Event") +
      "</h2><p>" +
      E(P.date(ev.date)) +
      (ev.headCount ? " · " + E(ev.headCount) + " guests" : "") +
      "</p><p>Earliest hard setup: " +
      E(P.date(P.add(ev.date, -rules.hardDays))) +
      "</p><p>Linens: " +
      E(
        ev.vendors
          .filter((v) => v.kind === "linen")
          .map((v) => P.windowText(v, "loadIn"))
          .join("; ") || "No linen vendor entered",
      ) +
      '</p><div class="toolbar">' +
      (owner()
        ? '<a href="index.html?event=' +
          encodeURIComponent(ev.cloudId) +
          '">Open in intake app</a>' +
          button("Remove event", "remove-event", ev.cloudId)
        : "") +
      (ev.published
        ? ' <a href="status.html#e=' +
          encodeURIComponent(ev.cloudId) +
          '">Open status page</a>'
        : "") +
      "</div>" +
      attention(ev)
        .map(
          (i) =>
            '<p class="' +
            i.level +
            '">' +
            E(i.text) +
            (i.key.startsWith("coverage:") && owner()
              ? ' <a href="index.html?event=' +
                encodeURIComponent(ev.cloudId) +
                '#staffing">Assign in intake app</a>'
              : "") +
            "</p>",
        )
        .join("") +
      '<div id="vendors"><h3>Vendor schedule</h3>' +
      ev.vendors
        .map(
          (v) =>
            "<article><h4>" +
            E(v.name || "Vendor") +
            "</h4><p>Delivery: " +
            E(P.windowText(v, "loadIn")) +
            (v.loadInConfirmed ? "" : " (not confirmed)") +
            "</p><p>Pickup: " +
            E(P.windowText(v, "loadOut")) +
            (v.loadOutConfirmed ? "" : " (not confirmed)") +
            "</p>" +
            button("Edit schedule", "vendor", v.n) +
            "</article>",
        )
        .join("") +
      '</div><div id="confirm"><h3>Confirmations</h3>' +
      [
        ["guestCount", "Final guest count"],
        ["floorPlan", "Floor plan and table counts"],
        ["rentals", "What is being rented"],
        ...(owner() ? [["laundry", "Laundry pickup requested"]] : []),
      ]
        .map(
          ([k, t]) =>
            '<label><input type="checkbox" data-confirm="' +
            k +
            '"' +
            (ev.confirm[k]?.[k === "laundry" ? "requested" : "confirmed"]
              ? " checked"
              : "") +
            ">" +
            t +
            (ev.confirm[k]?.by ? " · " + E(ev.confirm[k].by) : "") +
            "</label>",
        )
        .join("") +
      '</div><div id="questions"><h3>Questions</h3>' +
      button("Copy questions", "copy") +
      Object.values(ev.questions)
        .filter((q) => ["waiting", "answered"].includes(q.status))
        .map(
          (q) =>
            "<article><p>" +
            E(q.text) +
            "</p><p>" +
            E((q.values || []).join(" or ")) +
            "</p>" +
            (q.status === "answered"
              ? "<p>Answer: " +
                E(q.answer || q.picked || "") +
                " · " +
                E(q.by) +
                "</p>"
              : !owner()
                ? button("Answer", "answer", q.id)
                : "<p>Waiting on planner</p>") +
            "</article>",
        )
        .join("") +
      '</div><div id="shifts"><h3>Shifts</h3>' +
      ev.staffing.shifts
        .map(
          (s) =>
            "<article><p>" +
            E(shiftText(s)) +
            "</p>" +
            P.shiftWarnings(ev, rules, blocks)
              .filter((w) => w.shift === s.n)
              .map((w) => "<p>" + E(w.text) + "</p>")
              .join("") +
            (owner() ? button("Edit shift", "shift", s.n) : "") +
            "</article>",
        )
        .join("") +
      (owner() ? button("Add shift", "shift") : "") +
      "</div>"
    );
  }
  async function changeShift(id) {
    const ev = events.find((e) => e.cloudId === selected),
      saved = await C.loadDraft(ev.cloudId),
      data = JSON.parse(saved.text);
    let st = data.intake;
    st.staffing ||= {
      shifts: [],
      tasks: [],
      receivers: {},
      nextShift: 1,
      nextTask: 1,
    };
    const sh = st.staffing.shifts.find((s) => String(s.n) === id);
    U.shiftEditor(sh, roster, async (result) => {
      if (sh) Object.assign(sh, result);
      else st.staffing.shifts.push({ n: st.staffing.nextShift++, ...result });
      await C.saveEvent(
        ev.cloudId,
        {
          date: st.event.date,
          client: st.event.clientName || "",
          headCount: String(st.event.headCount || ""),
        },
        JSON.stringify(data),
        saved.savedAt,
      );
      await refresh();
    });
  }
  $("app").onclick = (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    run(async () => {
      const a = b.dataset.action,
        id = b.dataset.id,
        ev = events.find((e) => e.cloudId === selected);
      if (a === "event" || a === "attention") {
        selected = id.split("|")[0];
        render();
        $(
          a === "event"
            ? "eventPanel"
            : id.split("|")[1]?.startsWith("vendor:")
              ? "vendors"
              : id.split("|")[1]?.startsWith("question:")
                ? "questions"
                : id.split("|")[1]?.startsWith("shift:")
                  ? "shifts"
                  : "confirm",
        )?.scrollIntoView();
      } else if (["prev", "next", "today"].includes(a)) {
        const d = new Date(month + "-15T12:00:00");
        d.setMonth(d.getMonth() + (a === "prev" ? -1 : 1));
        month =
          a === "today"
            ? today().slice(0, 7)
            : d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        render();
      } else if (a === "add-event" && owner())
        U.dialog(
          "Add event",
          U.field("name", "Event name") +
            U.field("date", "Event date", "", "date"),
          async (f) => {
            if (!f.get("name").trim() || !f.get("date"))
              throw Error("Enter a name and date.");
            const cid = await C.newId(),
              draft = {
                format: "elm-event-intake",
                formatVersion: 1,
                intake: {
                  event: {
                    clientName: f.get("name").trim(),
                    date: f.get("date"),
                  },
                },
              };
            await C.saveEvent(
              cid,
              {
                client: f.get("name").trim(),
                date: f.get("date"),
                eventId: "",
                headCount: "",
              },
              JSON.stringify(draft),
              null,
            );
            selected = cid;
            await refresh();
          },
        );
      else if ((a === "add-block" || a === "block") && owner()) {
        const block = blocks.find((b) => b.id === id);
        U.dialog(
          "Venue booking",
          U.field("label", "Label", block?.label) +
            U.field("start", "Start date", block?.start, "date") +
            U.field("end", "End date, optional", block?.end, "date") +
            (block
              ? '<label><input type="checkbox" name="remove">Remove this booking</label>'
              : ""),
          async (f) => {
            if (f.has("remove")) await C.setBlock(id, null);
            else {
              if (
                !f.get("label").trim() ||
                !f.get("start") ||
                (f.get("end") && f.get("end") < f.get("start"))
              )
                throw Error("Enter a label and valid dates.");
              await C.setBlock(id, {
                label: f.get("label").trim(),
                start: f.get("start"),
                end: f.get("end"),
              });
            }
            await refresh();
          },
        );
      } else if (a === "person" && owner()) {
        const p = roster.find((p) => p.id === id);
        U.dialog(
          "Staff member",
          U.field("name", "Name", p?.name) +
            '<label><input name="active" type="checkbox"' +
            (!p || p.active ? " checked" : "") +
            ">Active</label>",
          async (f) => {
            if (!f.get("name").trim()) throw Error("Enter a name.");
            const next = roster.map((p) => ({ ...p })),
              row = next.find((p) => p.id === id) || {
                id: crypto.randomUUID(),
              };
            Object.assign(row, {
              name: f.get("name").trim(),
              active: f.has("active"),
            });
            if (!id) next.push(row);
            await C.setSetting("roster", { people: next });
            await refresh();
          },
        );
      } else if (
        a === "remove-event" &&
        owner() &&
        confirm("Remove this saved event and its online records?")
      ) {
        await C.removeEvent(id);
        selected = "";
        await refresh();
      } else if (a === "shift" && owner()) await changeShift(id);
      else if (a === "vendor") {
        const v = ev.vendors.find((v) => String(v.n) === id);
        U.vendorEditor(v, async (changes) => {
          const name = by();
          await C.changeShared(ev.cloudId, "vendors", (d) => {
            d.schedule ||= {};
            d.schedule[id] ||= {};
            Object.entries(changes).forEach(([k, value]) => {
              if (value !== v[k])
                d.schedule[id][k] = {
                  value,
                  updatedAt: Date.now(),
                  updatedBy: name,
                };
            });
            return d;
          });
          await refresh();
        });
      } else if (a === "copy") {
        await navigator.clipboard.writeText(
          Object.values(ev.questions)
            .filter((q) => q.status === "waiting")
            .map(
              (q) =>
                q.text +
                ((q.values || []).length ? "\n" + q.values.join(" or ") : ""),
            )
            .join("\n\n"),
        );
        message("Questions copied.");
      } else if (a === "answer" && !owner()) {
        const q = ev.questions[id];
        U.dialog(
          "Answer question",
          "<p>" +
            E(q.text) +
            '</p><label>Answer<textarea name="answer"></textarea></label><label>Choose a value, optional<select name="picked"><option value="">No selection</option>' +
            (q.values || [])
              .map((v) => "<option>" + E(v) + "</option>")
              .join("") +
            "</select></label>",
          async (f) => {
            const name = by();
            if (!f.get("answer").trim() && !f.get("picked"))
              throw Error("Enter an answer or choose a value.");
            await C.changeShared(ev.cloudId, "questions", (d) => {
              if (d[id]?.status !== "waiting")
                throw Error("This question changed. Refresh before answering.");
              d[id] = {
                ...d[id],
                answer: f.get("answer"),
                picked: f.get("picked"),
                by: name,
                answeredAt: Date.now(),
                status: "answered",
              };
              return d;
            });
            await refresh();
          },
        );
      }
    });
  };
  $("app").onchange = (e) => {
    const k = e.target.dataset.confirm;
    if (!k) return;
    const checked = e.target.checked;
    e.target.disabled = true;
    run(async () => {
      const ev = events.find((e) => e.cloudId === selected),
        name = by();
      await C.changeShared(ev.cloudId, "confirm", (d) => ({
        ...d,
        [k]: {
          [k === "laundry" ? "requested" : "confirmed"]: checked,
          by: name,
          at: Date.now(),
        },
      }));
      await refresh();
    }).finally(() => {
      e.target.disabled = false;
    });
  };
  function signIn() {
    $("app").innerHTML =
      '<section><h2>Sign in</h2><form id="login"><label>Password<input name="password" type="password" required autocomplete="current-password"></label><details><summary>Use a different email</summary><label>Email<input name="email" type="email" value="' +
      E(C.config.plannerEmail || C.config.ownerEmail) +
      '" autocomplete="username"></label></details><button>Sign in</button></form></section>';
    $("login").onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      run(() => C.signIn(f.get("email"), f.get("password")));
    };
  }
  $("signOut").onclick = () => run(() => C.signOut());
  if (!C.configured) {
    $("app").innerHTML = "<p>Online planning is not configured.</p>";
    return;
  }
  C.onUser((u) => {
    user = u;
    $("signOut").hidden = !u;
    if (!u) signIn();
    else if (!["owner", "planner"].includes(u.role))
      $("app").innerHTML =
        '<p>This sign-in can view published events on the <a href="status.html">status page</a>.</p>';
    else refresh().catch((e) => message(e.message));
  });
  C.init().catch((e) => message(e.message));
})();
