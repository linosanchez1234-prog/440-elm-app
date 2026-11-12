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
    'use strict';
    var SDK_VERSION = '13.3.0';
    var SDK_BASE = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';
    var SDK_FILES = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'];
    var PART_CHARS = 200000;      // each draft part stays far below Firestore's 1 MiB document limit
    var MAX_PARTS = 40;

    var cfg = window.ELM_CLOUD_CONFIG || {};
    var configured = !!(cfg.firebase && cfg.firebase.apiKey && cfg.firebase.projectId);
    var ready = null, auth = null, db = null, user = null, authKnown = false;
    var userListeners = [];

    function lower(s) { return String(s || '').trim().toLowerCase(); }
    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script'); s.src = src; s.async = false;
            s.onload = resolve;
            s.onerror = function () { reject(new Error('Could not load the online sharing library. Check the internet connection.')); };
            document.head.appendChild(s);
        });
    }
    function init() {
        if (!configured) return Promise.reject(new Error('Online sharing is not set up. See SETUP.md.'));
        if (ready) return ready;
        ready = SDK_FILES.reduce(function (p, f) { return p.then(function () { return loadScript(SDK_BASE + f); }); }, Promise.resolve())
            .then(function () {
                var fb = window.firebase;
                if (!fb || !fb.initializeApp) throw new Error('The online sharing library did not start.');
                var app = fb.apps && fb.apps.length ? fb.app() : fb.initializeApp(cfg.firebase);
                auth = app.auth(); db = app.firestore();
                return new Promise(function (resolve) {
                    auth.onAuthStateChanged(function (u) {
                        user = u || null; authKnown = true;
                        userListeners.slice().forEach(function (cb) { try { cb(describeUser()); } catch (e) { console.error(e); } });
                        resolve();
                    });
                });
            });
        ready.catch(function () { ready = null; });
        return ready;
    }
    function role() {
        if (!user) return null;
        var e = lower(user.email);
        if (e && e === lower(cfg.ownerEmail)) return 'owner';
        if (e && e === lower(cfg.staffEmail)) return 'staff';
        return 'unknown';
    }
    function describeUser() { return user ? { email: user.email || '', role: role() } : null; }
    function onUser(cb) {
        userListeners.push(cb);
        if (authKnown) cb(describeUser());
        return function () { userListeners = userListeners.filter(function (x) { return x !== cb; }); };
    }
    function friendly(err) {
        var code = (err && err.code) || '';
        if (/wrong-password|invalid-credential|user-not-found|invalid-login/.test(code)) return new Error('That email or password is not right.');
        if (/invalid-email/.test(code)) return new Error('That email address is not valid.');
        if (/too-many-requests/.test(code)) return new Error('Too many tries. Wait a few minutes and try again.');
        if (/network-request-failed|unavailable/.test(code)) return new Error('No connection to the online storage. Check the internet and try again.');
        if (/permission-denied/.test(code)) return new Error('This sign-in is not allowed to do that. Check the emails in cloud-config.js and firestore.rules.');
        if (/resource-exhausted/.test(code)) return new Error('The free daily storage limit was reached. It resets at midnight Pacific time.');
        return err instanceof Error ? err : new Error(String(err));
    }
    function guard(p) { return p.catch(function (e) { throw friendly(e); }); }

    function signIn(email, password) { return init().then(function () { return guard(auth.signInWithEmailAndPassword(String(email).trim(), password)); })
            .then(function (cred) { if (cred && cred.user) user = cred.user; return describeUser(); });
    }
    function signOut() { return init().then(function () { return auth.signOut(); }); }

    function events() { return db.collection('events'); }
    function newId() { return events().doc().id; }
    function snapData(snap) { var d = snap.data() || {}; d.cloudId = snap.id; return d; }

    // Owner sees every saved event. Staff rules only allow published ones, so the query has to say so.
    function listEvents(onlyPublished) {
        return init().then(function () {
            var q = onlyPublished || role() !== 'owner' ? events().where('published', '==', true) : events();
            return guard(q.get());
        }).then(function (res) {
            var out = []; res.forEach(function (s) { out.push(snapData(s)); });
            out.sort(function (a, b) { return String(a.date || '9999').localeCompare(String(b.date || '9999')) || String(a.eventId || '').localeCompare(String(b.eventId || '')); });
            return out;
        });
    }
    function splitParts(text) {
        var parts = []; for (var i = 0; i < text.length; i += PART_CHARS) parts.push(text.slice(i, i + PART_CHARS));
        return parts.length ? parts : [''];
    }
    // summary: small fields for lists. draftText: JSON of the intake answers.
    // lastSeen: the savedAt this browser last saw for the event (null for a first save, false to overwrite on purpose).
    // If the online copy changed since then, the save stops instead of overwriting newer answers.
    function saveEvent(cloudId, summary, draftText, lastSeen) {
        return init().then(function () {
            var parts = splitParts(draftText);
            if (parts.length > MAX_PARTS) throw new Error('This event is too large to save online (' + Math.round(draftText.length / 1000) + ' thousand characters). Export an event file instead.');
            var ref = events().doc(cloudId);
            return guard(ref.get()).then(function (snap) {
                var old = snap.exists ? (snap.data().draftParts || 0) : 0;
                if (snap.exists && lastSeen !== false && snap.data().savedAt && snap.data().savedAt !== lastSeen) {
                    var conflict = new Error('The online copy of this event was changed somewhere else. Open it from the online library, or choose "Save this event online" to replace it with what is on screen.');
                    conflict.conflict = true; throw conflict;
                }
                var batch = db.batch(), now = Date.now();
                var data = Object.assign({}, summary, { draftParts: parts.length, savedAt: now });
                if (!snap.exists) data.published = false;
                batch.set(ref, data, { merge: true });
                parts.forEach(function (text, i) { batch.set(ref.collection('draft').doc(String(i)), { i: i, total: parts.length, savedAt: now, text: text }); });
                for (var j = parts.length; j < old; j++) batch.delete(ref.collection('draft').doc(String(j)));
                return guard(batch.commit()).then(function () { return now; });
            });
        });
    }
    function loadDraft(cloudId) {
        return init().then(function () { return guard(events().doc(cloudId).get()); }).then(function (snap) {
            if (!snap.exists) throw new Error('That event is no longer in the online library.');
            var n = snap.data().draftParts || 0; if (!n) throw new Error('That event has no saved answers online.');
            var reads = []; for (var i = 0; i < n; i++) reads.push(guard(events().doc(cloudId).collection('draft').doc(String(i)).get()));
            return Promise.all(reads).then(function (docs) {
                var savedAt = snap.data().savedAt;
                var text = docs.map(function (d, i) {
                    if (!d.exists || d.data().total !== n || d.data().savedAt !== savedAt) throw new Error('The online copy of this event is incomplete (part ' + (i + 1) + ' of ' + n + '). Nothing was opened.');
                    return d.data().text;
                }).join('');
                return { text: text, savedAt: savedAt };
            });
        });
    }
    // published: { sheetVersion, sheetJson, shiftsJson, ...summary fields }
    function publish(cloudId, published) {
        return init().then(function () {
            return guard(events().doc(cloudId).set(Object.assign({}, published, { published: true, publishedAt: Date.now() }), { merge: true }));
        });
    }
    function unpublish(cloudId) { return init().then(function () { return guard(events().doc(cloudId).set({ published: false }, { merge: true })); }); }
    function removeEvent(cloudId) {
        return init().then(function () { return guard(events().doc(cloudId).get()); }).then(function (snap) {
            var ref = events().doc(cloudId), batch = db.batch(), n = snap.exists ? (snap.data().draftParts || 0) : 0;
            for (var i = 0; i < n; i++) batch.delete(ref.collection('draft').doc(String(i)));
            batch.delete(ref.collection('status').doc('items'));
            batch.delete(ref);
            return guard(batch.commit());
        });
    }
    function watch(ref, cb, onError) {
        return ref.onSnapshot(function (snap) { cb(snap.exists ? snapData(snap) : null); }, function (e) { if (onError) onError(friendly(e)); });
    }
    function watchEvent(cloudId, cb, onError) { return watch(events().doc(cloudId), cb, onError); }
    function watchStatus(cloudId, cb, onError) {
        return watch(events().doc(cloudId).collection('status').doc('items'), function (d) { cb((d && d.items) || {}); }, onError);
    }
    function getStatus(cloudId) {
        return init().then(function () { return guard(events().doc(cloudId).collection('status').doc('items').get()); })
            .then(function (s) { return (s.exists && s.data().items) || {}; });
    }
    // change: any of { done, pull, set, by, note }. Merged into the item's mark, so a note never clears a tick.
    function setItemStatus(cloudId, key, change) {
        var mark = Object.assign({}, change, { at: Date.now() }), items = {}; items[key] = mark;
        return init().then(function () { return guard(events().doc(cloudId).collection('status').doc('items').set({ items: items }, { merge: true })); });
    }

    window.ElmCloud = {
        configured: configured, sdkVersion: SDK_VERSION, config: { ownerEmail: cfg.ownerEmail || '', staffEmail: cfg.staffEmail || '' },
        init: init, onUser: onUser, user: describeUser, signIn: signIn, signOut: signOut, newId: function () { return init().then(newId); },
        listEvents: listEvents, saveEvent: saveEvent, loadDraft: loadDraft, publish: publish, unpublish: unpublish, removeEvent: removeEvent,
        watchEvent: watchEvent, watchStatus: watchStatus, getStatus: getStatus, setItemStatus: setItemStatus
    };
})();
