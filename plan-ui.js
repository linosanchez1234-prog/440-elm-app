/* Shared accessible editors for the intake and calendar pages (2026-11-12). */
(function () {
  "use strict";
  const esc = (x) =>
    String(x ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const field = (name, label, value = "", type = "text") =>
    "<label>" +
    esc(label) +
    '<input name="' +
    name +
    '" type="' +
    type +
    '" value="' +
    esc(value) +
    '"></label>';
  function dialog(title, body, save) {
    const d = document.createElement("dialog");
    d.className="staff-dialog plan-dialog";
    d.innerHTML =
      "<form><h2>" +
      esc(title) +
      "</h2>" +
      body +
      '<p role="alert"></p><div class="toolbar"><button type="submit">Save</button><button type="button" data-cancel>Cancel</button></div></form>';
    document.body.append(d);
    d.querySelector("[data-cancel]").onclick = () => d.close();
    d.onclose = () => d.remove();
    d.querySelector("form").onsubmit = async (e) => {
      e.preventDefault();
      const b = d.querySelector("[type=submit]");
      b.disabled = true;
      try {
        await save(new FormData(e.target), d);
        d.close();
      } catch (err) {
        d.querySelector("[role=alert]").textContent = err.message;
        b.disabled = false;
      }
    };
    d.showModal();
    return d;
  }
  function peopleHtml(people, roster) {
    const names = String(people || "")
        .split("\n")
        .filter(Boolean),
      active = (roster || []).filter((p) => p.active);
    return (
      "<fieldset><legend>People</legend>" +
      active
        .map(
          (p, i) =>
            '<label><input type="checkbox" name="roster" value="' +
            esc(p.name) +
            '"' +
            (names.includes(p.name) ? " checked" : "") +
            ">" +
            esc(p.name) +
            "</label>",
        )
        .join("") +
      field(
        "slots",
        "Open slots",
        names.filter((n) => n === "Open slot").length,
        "number",
      ) +
      '<label>Other people, one name per line<textarea name="other">' +
      esc(
        names
          .filter((n) => n !== "Open slot" && !active.some((p) => p.name === n))
          .join("\n"),
      ) +
      "</textarea></label></fieldset>"
    );
  }
  function shiftEditor(shift, roster, save) {
    return dialog(
      shift ? "Edit shift" : "Add shift",
      field("label", "Shift name", shift?.label) +
        field(
          "start",
          "Start, including date",
          shift?.start,
          "datetime-local",
        ) +
        field("end", "End, including date", shift?.end, "datetime-local") +
        '<label>Phase<select name="phase">' +
        Object.entries(ElmPlan.phases)
          .map(
            ([k, v]) =>
              '<option value="' +
              k +
              '"' +
              (k === (shift?.phase || "") ? " selected" : "") +
              ">" +
              v +
              "</option>",
          )
          .join("") +
        "</select></label>" +
        peopleHtml(shift?.people, roster) +
        '<label>Goals<textarea name="goals">' +
        esc(shift?.goals) +
        "</textarea></label>",
      async (f) => {
        const n = Number(f.get("slots"));
        if (!Number.isInteger(n) || n < 0 || n > 100)
          throw Error("Enter an open slot count from 0 to 100.");
        const result = {
          label: f.get("label").trim(),
          start: f.get("start"),
          end: f.get("end"),
          phase: f.get("phase"),
          goals: f.get("goals"),
          people: [
            ...f.getAll("roster"),
            ...Array(n).fill("Open slot"),
            ...f
              .get("other")
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
          ].join("\n"),
        };
        if (result.start && result.end && result.end <= result.start)
          throw Error("End must be after start.");
        await save(result);
      },
    );
  }
  function rows(data) {
    return Object.values(data.rows || {}).map((v) => {
      const next = { ...v };
      ElmPlan.scheduleFields.forEach((k) => {
        const cell = data.schedule?.[v.n]?.[k];
        if (cell) next[k] = cell.value;
      });
      return next;
    });
  }
  function vendorEditor(v, save) {
    dialog(
      v.name || "Vendor",
      ["loadIn", "loadOut"]
        .map(
          (k) =>
            "<fieldset><legend>" +
            (k === "loadIn" ? "Delivery" : "Pickup") +
            "</legend>" +
            field(k + "Date", "Date", v[k + "Date"], "date") +
            field(k + "Time", "Window starts", v[k + "Time"]) +
            field(k + "TimeEnd", "Window ends", v[k + "TimeEnd"]) +
            '<label><input type="checkbox" name="' +
            k +
            'Confirmed"' +
            (v[k + "Confirmed"] ? " checked" : "") +
            ">Confirmed</label></fieldset>",
        )
        .join(""),
      async (f) => {
        const changes = {};
        ElmPlan.scheduleFields.forEach(
          (k) => (changes[k] = k.endsWith("Confirmed") ? f.has(k) : f.get(k)),
        );
        await save(changes);
      },
    );
  }
  window.ElmPlanUI = { esc, field, dialog, shiftEditor, rows, vendorEditor };
})();
