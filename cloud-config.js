/* 440 Elm online sharing settings.
   Leave "firebase" as null to keep the app exactly as before: nothing is sent anywhere.
   To turn sharing on, follow SETUP.md and paste the three values below.
   These values are identifiers, not passwords. The sign-in passwords and the
   database rules (firestore.rules) are what protect the data. */
window.ELM_CLOUD_CONFIG = {
    firebase: null,
    // Example:
    // firebase: {
    //     apiKey: "...",
    //     authDomain: "your-project.firebaseapp.com",
    //     projectId: "your-project",
    //     appId: "..."
    // },
    ownerEmail: "",   // your sign-in. Can save, publish and tick items.
    staffEmail: ""    // the one shared staff sign-in. Can only view published events.
};
