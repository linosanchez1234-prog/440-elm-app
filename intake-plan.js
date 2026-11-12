/* Online planning stays optional and leaves paper completion unchanged (2026-11-12). */
(function () {
  "use strict";
  ElmIntake.attention = ElmPlan.attention;
  if (!cloudOn()) return;
  const C = ElmCloud,
    P = ElmPlan,
    U = ElmPlanUI,
    E = escapeHtml;
  let roster = [],
    rules = { ...P.defaults },
    blocks = [],
    watched = "",
    watchedDraft = null,
    stops = [],
    opening = false;
  const originalShift = staffEditShift;
  staffEditShift = function (existing) {
    if (!cloudIsOwner()) return originalShift(existing);
    const plan = staffPlan();
    U.shiftEditor(existing, roster, async (next) => {
      if (existing) Object.assign(existing, next);
      else plan.shifts.push({ n: plan.nextShift++, ...next });
      renderStaffing();
      saveDraft(true);
      renderLive();
    });
  };
  const originalVendor = ROW_TEMPLATES.vendors;
  ROW_TEMPLATES.vendors = (v, i) =>
    originalVendor(v, i) +
    '<div class="row-grid"><label>Vendor kind<select data-plan-kind="' +
    i +
    '">' +
    ["other", "linen", "laundry", "rental"]
      .map(
        (k) =>
          '<option value="' +
          k +
          '"' +
          ((v.kind || "other") === k ? " selected" : "") +
          ">" +
          k[0].toUpperCase() +
          k.slice(1) +
          "</option>",
      )
      .join("") +
    '</select></label><label><input type="checkbox" data-plan-presence="' +
    i +
    '"' +
    (P.vendor(v).needsPresence ? " checked" : "") +
    ">Someone must let them in</label>" +
    ["loadIn", "loadOut"]
      .map(
        (k) =>
          "<label>" +
          (k === "loadIn" ? "Delivery" : "Pickup") +
          ' window ends<input data-bind="vendors.' +
          i +
          "." +
          k +
          'TimeEnd" value="' +
          E(v[k + "TimeEnd"] || "") +
          '"></label><label><input type="checkbox" data-bind="vendors.' +
          i +
          "." +
          k +
          'Confirmed"' +
          (v[k + "Confirmed"] ? " checked" : "") +
          ">Window confirmed</label>",
      )
      .join("") +
    "</div>";
  const originalIssue = renderIssue;
  renderIssue = function (i) {
    let html = originalIssue(i);
    if (!cloudIsOwner() || i.status !== "open") return html;
    const q = state.plannerQuestions?.[i.id];
    return (
      html +
      '<div class="ri-actions">' +
      (!q || q.status === "closed"
        ? '<button data-plan-ask="' + E(i.id) + '">Ask the planner</button>'
        : q.status === "waiting"
          ? "<p>Waiting on planner</p>"
          : "<p>" +
            E(q.answer || q.picked || "") +
            " · " +
            E(q.by || "") +
            "</p>" +
            (canApply(i, q)
              ? '<button data-plan-apply="' +
                E(i.id) +
                '">Apply and close</button>'
              : "") +
            '<button data-plan-close="' +
            E(i.id) +
            '">Close</button>') +
      "</div>"
    );
  };
  function canApply(i, q) {
    const path = issueField(i);
    return (
      q?.picked &&
      (q.values || []).includes(q.picked) &&
      ["event.headCount", "event.date", "event.clientName"].includes(path)
    );
  }
  const originalStaff = renderStaffing;
  renderStaffing = function () {
    originalStaff();
    const host = document.getElementById("staffingContent");
    if (!host) return;
    host.querySelector("[data-plan-warnings]")?.remove();
    const warnings=P.shiftWarnings(state,rules,blocks);
    (staffPlan().shifts||[]).forEach(sh=>{
      const card=host.querySelector('[data-staff-action="edit-shift"][data-id="'+sh.n+'"]')?.closest('.staff-card');
      if(!card)return;
      const box=document.createElement('div');box.dataset.planWarnings='';
      if(sh.phase){const p=document.createElement('p');p.textContent=P.phases[sh.phase];box.append(p);}
      warnings.filter(w=>w.shift===sh.n).forEach(w=>{const p=document.createElement('p');p.textContent=w.text;box.append(p);});
      card.append(box);
    });
  };
  const originalRender = renderCloud;
  renderCloud = function () {
    originalRender();
    sync();
  };
  function notice(text) {
    let box = document.getElementById("plannerNotice");
    if (!box) {
      box = document.createElement("div");
      box.id = "plannerNotice";
      box.className = "warnings";
      box.setAttribute("role", "status");
      document.querySelector("main")?.prepend(box);
    }
    box.replaceChildren();
    const p = document.createElement("p");
    p.textContent = text;
    const b = document.createElement("button");
    b.textContent = "Dismiss";
    b.onclick = () => box.remove();
    box.append(p, b);
  }
  function sync() {
    const id = cloudIsOwner() ? cloudLink().id : "";
    if (id === watched && watchedDraft === state) return;
    stops.forEach((f) => f());
    stops = [];
    watched = id;
    watchedDraft = state;
    if (!id) return;
    const draft = state;
    stops.push(
      C.watchShared(
        id,
        "vendors",
        (d) => {
          if (state !== draft || !d) return;
          const applied = [];
          (draft.vendors || []).forEach((v) => {
            P.scheduleFields.forEach((k) => {
              const r = d.schedule?.[v.n]?.[k];
              if (!r || r.updatedAt <= (v.scheduleMeta?.[k]?.updatedAt || 0))
                return;
              const changed = v[k] !== r.value;
              if (
                typeof r.value !==
                (k.endsWith("Confirmed") ? "boolean" : "string")
              )
                return;
              v.scheduleMeta ||= {};
              v.scheduleMeta[k] = {
                updatedAt: r.updatedAt,
                updatedBy: r.updatedBy,
              };
              if (changed) {
                v[k] = r.value;
                applied.push(
                  (v.name || "Vendor") +
                    ", " +
                    (k.startsWith("loadIn") ? "delivery " : "pickup ") +
                    P.windowText(
                      v,
                      k.startsWith("loadIn") ? "loadIn" : "loadOut",
                    ) +
                    " (by " +
                    r.updatedBy +
                    ")",
                );
              }
            });
          });
          if (applied.length) {
            renderRows("vendors");
            renderLive();
            notice(
              "Planner updates applied: " + [...new Set(applied)].join("; "),
            );
            saveDraft(true);
          }
        },
        (e) => notice(e.message),
      ),
    );
    stops.push(
      C.watchShared(
        id,
        "questions",
        (d) => {
          if (state !== draft) return;
          const q = { ...d };
          delete q.cloudId;
          draft.plannerQuestions = q;
          renderIntake();
          renderLive();
          cloudPersistLocal();
        },
        (e) => notice(e.message),
      ),
    );
  }
  document.addEventListener(
    "input",
    (e) => {
      const m = /^vendors\.(\d+)\.(.+)$/.exec(e.target.dataset.bind || "");
      if (!m || !P.scheduleFields.includes(m[2])) return;
      const v = state.vendors[+m[1]];
      if (v) {
        v.scheduleMeta ||= {};
        v.scheduleMeta[m[2]] = { updatedAt: Date.now(), updatedBy: "owner" };
      }
    },
    true,
  );
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.planKind !== undefined) {
      const v = state.vendors[+el.dataset.planKind];
      v.kind = el.value;
      if (!v.presenceManual)
        v.needsPresence = !["linen", "laundry"].includes(v.kind);
      renderRows("vendors");
      saveDraft(true);
    }
    if (el.dataset.planPresence !== undefined) {
      const v = state.vendors[+el.dataset.planPresence];
      v.needsPresence = el.checked;
      v.presenceManual = true;
      saveDraft(true);
    }
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest(
      "[data-plan-ask],[data-plan-close],[data-plan-apply]",
    );
    if (!b) return;
    b.disabled = true;
    const draft = state,
      id = b.dataset.planAsk || b.dataset.planClose || b.dataset.planApply,
      i = intakeState().issues.find((i) => i.id === id);
    try {
      if (!cloudIsOwner() || !cloudLink().id)
        throw Error("Save this event online before asking the planner.");
      const cid = cloudLink().id;
      if (b.dataset.planAsk) {
        const values = (i.values || [])
          .map((v) =>
            typeof v === "object" ? String(v.value ?? "") : String(v),
          )
          .filter(Boolean);
        await C.changeShared(cid, "questions", (d) => ({
          ...d,
          [id]: {
            id,
            text: i.text,
            values,
            status: "waiting",
            askedAt: Date.now(),
          },
        }));
      } else {
        const q = state.plannerQuestions[id];
        if (b.dataset.planApply) {
          if (!canApply(i, q))
            throw Error("Review this answer in the form before closing.");
          if (
            issueField(i) === "event.headCount" &&
            (!/^\d+$/.test(q.picked) || Number(q.picked) < 1)
          )
            throw Error("Enter a valid guest count in the form.");
        }
        await C.changeShared(cid, "questions", (d) => {
          if (d[id]?.answeredAt !== q.answeredAt)
            throw Error("The planner answer changed. Review it again.");
          d[id] = { ...d[id], status: "closed", closedAt: Date.now() };
          return d;
        });
        if (state === draft) {
          if (b.dataset.planApply) setPath(state, issueField(i), q.picked);
          i.status = "answered";
          i.note = q.answer || q.picked || "";
          rebuildAfterAccept();
        }
      }
    } catch (err) {
      notice(err.message);
    } finally {
      b.disabled = false;
    }
  });
  async function badge() {
    if (!cloudIsOwner()) return;
    const events = await C.listEvents(false);
    let count = 0;
    await Promise.all(
      events.map(async (ev) => {
        const [v, c, q] = await Promise.all(
          ["vendors", "confirm", "questions"].map((k) =>
            C.getShared(ev.cloudId, k),
          ),
        );
        count += P.attention(
          {
            ...ev,
            vendors: U.rows(v),
            confirm: c,
            questions: q,
            staffing: {
              shifts: JSON.parse(ev.shiftsSummaryJson || "[]"),
              receivers: JSON.parse(ev.receiversJson || "{}"),
            },
          },
          new Date().getFullYear() +
            "-" +
            String(new Date().getMonth() + 1).padStart(2, "0") +
            "-" +
            String(new Date().getDate()).padStart(2, "0"),
          rules,
          blocks,
        ).filter((i) => i.level === "urgent").length;
      }),
    );
    $("cloudEventsBtn").textContent =
      "Events" + (count ? " (" + count + ")" : "");
  }
  C.onUser(async (u) => {
    if (u?.role !== "owner") {
      sync();
      return;
    }
    try {
      const [r, ru, bs] = await Promise.all([
        C.getSetting("roster"),
        C.getSetting("rules"),
        C.listBlocks(),
      ]);
      roster = r.people || [];
      rules = { ...P.defaults, ...ru };
      blocks = bs;
      const id = new URLSearchParams(location.search).get("event");
      if (id && !opening) {
        opening = true;
        await cloudOpen({ cloudId: id });
        history.replaceState(null, "", location.pathname);
      }
      sync();
      renderIntake();
      renderStaffing();
      await badge();
    } catch (e) {
      notice(e.message);
    }
  });
})();
