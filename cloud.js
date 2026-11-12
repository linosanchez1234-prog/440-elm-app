/* ============================================================================
   440 Elm online sharing. Used by index.html (intake) and status.html (phone status page).
   No build step. Nothing here runs unless cloud-config.js holds a Firebase project.

   What is stored online (Cloud Firestore):
     events/{id}                 summary + the published checklist and shifts (owner writes, staff reads if published)
     events/{id}/draft/{n}       the full intake answers, in parts (owner only)
     events/{id}/status/items    done marks, who, when, notes (owner and staff write)
   Uploaded job sheets and floor plans are still read in the browser and are never uploaded as files.
   The answers and review notes taken from them are part of the intake answers saved online.
   ========================================================================== */
(function () {
  "use strict";
  var SDK_VERSION = "13.3.0";
  var SDK_BASE = "https://www.gstatic.com/firebasejs/" + SDK_VERSION + "/";
  var SDK_FILES = [
    "firebase-app-compat.js",
    "firebase-auth-compat.js",
    "firebase-firestore-compat.js",
  ];
  var PART_CHARS = 200000; // each draft part stays far below Firestore's 1 MiB document limit
  var MAX_PARTS = 40;

  var cfg = window.ELM_CLOUD_CONFIG || {};
  var configured = !!(
    cfg.firebase &&
    cfg.firebase.apiKey &&
    cfg.firebase.projectId
  );
  var ready = null,
    auth = null,
    db = null,
    user = null,
    authKnown = false;
  var userListeners = [];

  function lower(s) {
    return String(s || "")
      .trim()
      .toLowerCase();
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = function () {
        reject(
          new Error(
            "Could not load the online sharing library. Check the internet connection.",
          ),
        );
      };
      document.head.appendChild(s);
    });
  }
  function init() {
    if (!configured)
      return Promise.reject(
        new Error("Online sharing is not set up. See SETUP.md."),
      );
    if (ready) return ready;
    ready = SDK_FILES.reduce(function (p, f) {
      return p.then(function () {
        return loadScript(SDK_BASE + f);
      });
    }, Promise.resolve()).then(function () {
      var fb = window.firebase;
      if (!fb || !fb.initializeApp)
        throw new Error("The online sharing library did not start.");
      var app =
        fb.apps && fb.apps.length ? fb.app() : fb.initializeApp(cfg.firebase);
      auth = app.auth();
      db = app.firestore();
      return new Promise(function (resolve) {
        auth.onAuthStateChanged(function (u) {
          user = u || null;
          authKnown = true;
          userListeners.slice().forEach(function (cb) {
            try {
              cb(describeUser());
            } catch (e) {
              console.error(e);
            }
          });
          resolve();
        });
      });
    });
    ready.catch(function () {
      ready = null;
    });
    return ready;
  }
  function role() {
    if (!user) return null;
    var e = lower(user.email);
    if (e && e === lower(cfg.ownerEmail)) return "owner";
    if (e && e === lower(cfg.staffEmail)) return "staff";
    if (e && e === lower(cfg.plannerEmail)) return "planner";
    return "unknown";
  }
  function describeUser() {
    return user ? { email: user.email || "", role: role() } : null;
  }
  function onUser(cb) {
    userListeners.push(cb);
    if (authKnown) cb(describeUser());
    return function () {
      userListeners = userListeners.filter(function (x) {
        return x !== cb;
      });
    };
  }
  function friendly(err) {
    var code = (err && err.code) || "";
    if (
      /wrong-password|invalid-credential|user-not-found|invalid-login/.test(
        code,
      )
    )
      return new Error("That email or password is not right.");
    if (/invalid-email/.test(code))
      return new Error("That email address is not valid.");
    if (/too-many-requests/.test(code))
      return new Error("Too many tries. Wait a few minutes and try again.");
    if (/network-request-failed|unavailable/.test(code))
      return new Error(
        "No connection to the online storage. Check the internet and try again.",
      );
    if (/permission-denied/.test(code))
      return new Error(
        "This sign-in is not allowed to do that. Check the emails in cloud-config.js and firestore.rules.",
      );
    if (/resource-exhausted/.test(code))
      return new Error(
        "The free daily storage limit was reached. It resets at midnight Pacific time.",
      );
    return err instanceof Error ? err : new Error(String(err));
  }
  function guard(p) {
    return p.catch(function (e) {
      throw friendly(e);
    });
  }

  function signIn(email, password) {
    return init()
      .then(function () {
        return guard(
          auth.signInWithEmailAndPassword(String(email).trim(), password),
        );
      })
      .then(function (cred) {
        if (cred && cred.user) user = cred.user;
        return describeUser();
      });
  }
  // Password-only sign-in (2026-11-12). Nobody types an email: the password is tried against each configured
  // sign-in, in the order given, and the first match opens. The three passwords must therefore be different.
  function signInWithPassword(password, order) {
    var emails = [];
    (order || ["owner", "planner", "staff"]).forEach(function (r) {
      var e = lower(cfg[r + "Email"]);
      if (e && emails.indexOf(e) < 0) emails.push(e);
    });
    if (!emails.length)
      return Promise.reject(
        new Error("No sign-ins are set up in cloud-config.js."),
      );
    return init().then(function () {
      var i = 0;
      function next() {
        if (i >= emails.length)
          throw new Error("That password is not right.");
        return auth.signInWithEmailAndPassword(emails[i++], password).then(
          function (cred) {
            if (cred && cred.user) user = cred.user;
            return describeUser();
          },
          function (e) {
            if (
              /wrong-password|invalid-credential|user-not-found|invalid-login|user-disabled/.test(
                (e && e.code) || "",
              )
            )
              return next();
            throw friendly(e);
          },
        );
      }
      return next();
    });
  }
  function signOut() {
    return init().then(function () {
      return auth.signOut();
    });
  }

  function events() {
    return db.collection("events");
  }
  function newId() {
    return events().doc().id;
  }
  function snapData(snap) {
    var d = snap.data() || {};
    d.cloudId = snap.id;
    return d;
  }

  // Owner sees every saved event. Staff rules only allow published ones, so the query has to say so.
  function listEvents(onlyPublished) {
    return init()
      .then(function () {
        var q =
          onlyPublished || !["owner", "planner"].includes(role())
            ? events().where("published", "==", true)
            : events();
        return guard(q.get());
      })
      .then(function (res) {
        var out = [];
        res.forEach(function (s) {
          out.push(snapData(s));
        });
        out.sort(function (a, b) {
          return (
            String(a.date || "9999").localeCompare(String(b.date || "9999")) ||
            String(a.eventId || "").localeCompare(String(b.eventId || ""))
          );
        });
        return out;
      });
  }
  function splitParts(text) {
    var parts = [];
    for (var i = 0; i < text.length; i += PART_CHARS)
      parts.push(text.slice(i, i + PART_CHARS));
    return parts.length ? parts : [""];
  }
  // summary: small fields for lists. draftText: JSON of the intake answers.
  // lastSeen: the savedAt this browser last saw for the event (null for a first save, false to overwrite on purpose).
  // If the online copy changed since then, the save stops instead of overwriting newer answers.
  function saveEvent(cloudId, summary, draftText, lastSeen) {
    return init().then(() =>
      guard(
        db.runTransaction(async (tx) => {
          const ref = events().doc(cloudId),
            vr = shared(cloudId, "vendors");
          const snap = await tx.get(ref),
            vs = await tx.get(vr),
            cs = await tx.get(shared(cloudId, "confirm")),
            old = snap.exists ? snap.data() : {};
          if (
            snap.exists &&
            lastSeen !== false &&
            old.savedAt &&
            old.savedAt !== lastSeen
          ) {
            const error = new Error(
              "The online copy of this event was changed somewhere else. Open it from Events before saving again.",
            );
            error.conflict = true;
            throw error;
          }
          const data = JSON.parse(draftText),
            st = data.intake,
            now = Math.max(Date.now(), (old.savedAt || 0) + 1);
          const sharedData = vs.exists ? vs.data() : {},
            rows = {},
            schedule = {};
          (st.vendors || []).forEach((v) => {
            rows[v.n] = {
              n: v.n,
              name: v.name || "",
              kind: v.kind || "other",
              needsPresence:
                v.needsPresence === undefined
                  ? !["linen", "laundry"].includes(v.kind)
                  : v.needsPresence,
            };
            schedule[v.n] = {};
            [
              "loadInDate",
              "loadInTime",
              "loadInTimeEnd",
              "loadInConfirmed",
              "loadOutDate",
              "loadOutTime",
              "loadOutTimeEnd",
              "loadOutConfirmed",
            ].forEach((k) => {
              const remote = sharedData.schedule?.[v.n]?.[k],
                local = v.scheduleMeta?.[k];
              if (v[k] === undefined && !remote) return;
              schedule[v.n][k] =
                remote && (!local || remote.updatedAt > local.updatedAt)
                  ? remote
                  : {
                      value:
                        v[k] === undefined
                          ? k.endsWith("Confirmed")
                            ? false
                            : ""
                          : v[k],
                      updatedAt: local?.updatedAt || now,
                      updatedBy: "owner",
                    };
            });
          });
          const parts = splitParts(draftText);
          if (parts.length > MAX_PARTS)
            throw new Error(
              "This event is too large to save online. Export an event file instead.",
            );
          const extra = {
            shiftsSummaryJson: JSON.stringify(st.staffing?.shifts || []),
            receiversJson: JSON.stringify(st.staffing?.receivers || {}),
            vendorCount: (st.vendors || []).length,
            hasJobSheet: !!(old.hasJobSheet || st.intake?.docs?.length),
          };
          tx.set(
            ref,
            Object.assign(
              {},
              summary,
              extra,
              { draftParts: parts.length, savedAt: now },
              snap.exists ? {} : { published: false },
            ),
            { merge: true },
          );
          parts.forEach((text, i) =>
            tx.set(ref.collection("draft").doc(String(i)), {
              i,
              total: parts.length,
              savedAt: now,
              text,
            }),
          );
          for (let i = parts.length; i < (old.draftParts || 0); i++)
            tx.delete(ref.collection("draft").doc(String(i)));
          tx.set(vr, { rows, schedule });
          if (!cs.exists)
            tx.set(shared(cloudId, "confirm"), {
              laundry: { requested: false, by: "", at: 0 },
            });
          return now;
        }),
      ),
    );
  }
  function loadDraft(cloudId) {
    return init()
      .then(function () {
        return guard(events().doc(cloudId).get());
      })
      .then(function (snap) {
        if (!snap.exists)
          throw new Error("That event is no longer in the online library.");
        var n = snap.data().draftParts || 0;
        if (!n) throw new Error("That event has no saved answers online.");
        var reads = [];
        for (var i = 0; i < n; i++)
          reads.push(
            guard(
              events().doc(cloudId).collection("draft").doc(String(i)).get(),
            ),
          );
        return Promise.all(reads).then(function (docs) {
          var savedAt = snap.data().savedAt;
          var text = docs
            .map(function (d, i) {
              if (
                !d.exists ||
                d.data().total !== n ||
                d.data().savedAt !== savedAt
              )
                throw new Error(
                  "The online copy of this event is incomplete (part " +
                    (i + 1) +
                    " of " +
                    n +
                    "). Nothing was opened.",
                );
              return d.data().text;
            })
            .join("");
          return { text: text, savedAt: savedAt };
        });
      });
  }
  // published: { sheetVersion, sheetJson, shiftsJson, ...summary fields }
  function publish(cloudId, published) {
    return init().then(function () {
      return guard(
        events()
          .doc(cloudId)
          .set(
            Object.assign({}, published, {
              published: true,
              publishedAt: Date.now(),
            }),
            { merge: true },
          ),
      );
    });
  }
  function unpublish(cloudId) {
    return init().then(function () {
      return guard(
        events().doc(cloudId).set({ published: false }, { merge: true }),
      );
    });
  }
  function removeEvent(cloudId) {
    return init()
      .then(function () {
        return guard(events().doc(cloudId).get());
      })
      .then(function (snap) {
        var ref = events().doc(cloudId),
          batch = db.batch(),
          n = snap.exists ? snap.data().draftParts || 0 : 0;
        for (var i = 0; i < n; i++)
          batch.delete(ref.collection("draft").doc(String(i)));
        batch.delete(ref.collection("status").doc("items"));
        ["vendors", "confirm", "questions"].forEach((k) =>
          batch.delete(ref.collection("shared").doc(k)),
        );
        batch.delete(ref);
        return guard(batch.commit());
      });
  }
  function watch(ref, cb, onError) {
    return ref.onSnapshot(
      function (snap) {
        cb(snap.exists ? snapData(snap) : null);
      },
      function (e) {
        if (onError) onError(friendly(e));
      },
    );
  }
  function watchEvent(cloudId, cb, onError) {
    return watch(events().doc(cloudId), cb, onError);
  }
  function watchStatus(cloudId, cb, onError) {
    return watch(
      events().doc(cloudId).collection("status").doc("items"),
      function (d) {
        cb((d && d.items) || {});
      },
      onError,
    );
  }
  function getStatus(cloudId) {
    return init()
      .then(function () {
        return guard(
          events().doc(cloudId).collection("status").doc("items").get(),
        );
      })
      .then(function (s) {
        return (s.exists && s.data().items) || {};
      });
  }
  // change: any of { done, pull, set, by, note }. Merged into the item's mark, so a note never clears a tick.
  function setItemStatus(cloudId, key, change) {
    var mark = Object.assign({}, change, { at: Date.now() }),
      items = {};
    items[key] = mark;
    return init().then(function () {
      return guard(
        events()
          .doc(cloudId)
          .collection("status")
          .doc("items")
          .set({ items: items }, { merge: true }),
      );
    });
  }

  // Shared planning records keep planner edits outside private intake drafts (2026-11-12).
  function shared(id, key) {
    return events().doc(id).collection("shared").doc(key);
  }
  function getShared(id, key) {
    return init()
      .then(() => guard(shared(id, key).get()))
      .then((s) => (s.exists ? s.data() : {}));
  }
  function changeShared(id, key, edit) {
    return init().then(() =>
      guard(
        db.runTransaction(async (tx) => {
          const ref = shared(id, key),
            snap = await tx.get(ref);
          const value = edit(snap.exists ? snap.data() : {});
          tx.set(ref, value);
          return value;
        }),
      ),
    );
  }
  function watchShared(id, key, cb, err) {
    return watch(shared(id, key), cb, err);
  }
  function getSetting(key) {
    return init()
      .then(() => guard(db.collection("settings").doc(key).get()))
      .then((s) => (s.exists ? s.data() : {}));
  }
  function setSetting(key, data) {
    return init().then(() =>
      guard(db.collection("settings").doc(key).set(data)),
    );
  }
  function listBlocks() {
    return init()
      .then(() => guard(db.collection("blocks").get()))
      .then((s) => {
        const a = [];
        s.forEach((d) => a.push({ ...d.data(), id: d.id }));
        return a;
      });
  }
  function setBlock(id, data) {
    return init().then(() => {
      const ref = db.collection("blocks").doc(id || undefined);
      return guard(data ? ref.set(data) : ref.delete());
    });
  }
  window.ElmCloud = {
    getShared,
    changeShared,
    watchShared,
    getSetting,
    setSetting,
    listBlocks,
    setBlock,
    configured: configured,
    sdkVersion: SDK_VERSION,
    config: {
      ownerEmail: cfg.ownerEmail || "",
      staffEmail: cfg.staffEmail || "",
      plannerEmail: cfg.plannerEmail || "",
    },
    init: init,
    onUser: onUser,
    user: describeUser,
    signIn: signIn,
    signInWithPassword: signInWithPassword,
    signOut: signOut,
    newId: function () {
      return init().then(newId);
    },
    listEvents: listEvents,
    saveEvent: saveEvent,
    loadDraft: loadDraft,
    publish: publish,
    unpublish: unpublish,
    removeEvent: removeEvent,
    watchEvent: watchEvent,
    watchStatus: watchStatus,
    getStatus: getStatus,
    setItemStatus: setItemStatus,
  };
})();
