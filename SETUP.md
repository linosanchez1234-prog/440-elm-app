# 440 Elm online sharing: one-time setup

The app works exactly as before until you finish these steps. Nothing is sent anywhere while
`cloud-config.js` still says `firebase: null`.

Storage is Google Firebase on its free plan (called Spark). It needs a Google account and no payment card.

## 1. Create the project
1. Go to https://console.firebase.google.com and choose **Create a project**. Name it anything, for example `elm-440`.
2. Turn Google Analytics off when asked. It is not needed.

## 2. Create the two sign-ins
1. In the left menu open **Build > Authentication**, then **Get started**.
2. Under **Sign-in method**, enable **Email/Password**. Leave "Email link" off.
3. Under **Users**, choose **Add user** twice:
   - your own email and a strong password. This is the owner sign-in.
   - one shared staff email and a password you are happy to give the team. It does not need to be a real mailbox,
     for example `staff@440elm.example`.
4. Under **Settings > Authorized domains**, add `linosanchez1234-prog.github.io`.

## 3. Create the database
1. Open **Build > Firestore Database**, then **Create database**.
2. Pick a location near you, for example `us-west1`. Start in **production mode**.
3. Open the **Rules** tab. Paste the whole of `firestore.rules` from this folder.
4. In the pasted rules, replace `owner@example.com` and `staff@example.com` with your two emails, in lowercase.
5. Choose **Publish**.

## 4. Connect the app
1. Open **Project settings** (the gear icon), scroll to **Your apps**, choose the web icon `</>`, and register an app.
   Skip Firebase Hosting.
2. Firebase shows a `firebaseConfig` block. Copy `apiKey`, `authDomain`, `projectId` and `appId` into `cloud-config.js`.
3. Put the same two emails in `ownerEmail` and `staffEmail`.
4. Commit `cloud-config.js`. These values are identifiers, not passwords. The passwords and the rules protect the data.

## 5. Try it
1. Open the intake app. Under **More** there is a new block, "Online library and staff status".
2. **Sign in** with the owner email. Fill in an event, then **Save this event online**.
3. **Publish status page for staff**.
4. Open `status.html` on a phone. Staff type only the shared password.

## How it behaves
- After the first "Save this event online", later edits save online by themselves a few seconds after you stop typing.
- **Open online library** lists every saved event. Opening one replaces the event on screen.
- The status page shows the version you last published. If you change the checklist, the top bar says
  "Publish again to update".
- Done marks stay when you publish a new version, because each line keeps its permanent code.
- The staff sign-in can only look. The owner sign-in can tick lines and add notes on the status page.
- Uploaded job sheets and floor plans are still read in the browser and are not uploaded as files. The answers,
  and the review notes taken from them, are part of what is saved online.

## Free plan limits
1 GiB of stored data, 50,000 reads and 20,000 writes per day. A few events a month uses a tiny part of this.
The project is not paused when it sits unused.
