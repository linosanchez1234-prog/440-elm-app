/* 440 Elm online sharing settings.
   Sharing is on. How it was set up is in SETUP.md.
   These values are identifiers, not passwords. The sign-in passwords and the
   database rules (firestore.rules) are what protect the data. */
window.ELM_CLOUD_CONFIG = {
    plannerEmail: "linosanchez1234+planner@gmail.com",
    // Project "440 Elm Events", created 2026-11-11. Set "firebase" to null to switch sharing off.
    firebase: {
        apiKey: "AIzaSyC1ZxsP00u86fTB3-6NIQMGcZotNYhW6gQ",
        authDomain: "elm-events-7b8b7.firebaseapp.com",
        projectId: "elm-events-7b8b7",
        appId: "1:498213453018:web:7c6b3dbb7a35ba19ff39e3"
    },
    ownerEmail: "linosanchez1234@gmail.com",        // your sign-in. Can save, publish and tick items.
    staffEmail: "linosanchez1234+staff@gmail.com"   // the one shared staff sign-in. Can view published events and tick lines.
};
