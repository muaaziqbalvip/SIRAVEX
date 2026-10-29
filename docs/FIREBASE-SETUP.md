# Firebase Setup — SIRAVEX v3.0

Project: `siravex-b6f72` (config already in `src/services/firebase/firebase.ts`).

## 1. Enable login methods
Firebase Console → Build → Authentication → Sign-in method → enable **Google** and **Email/Password**.

## 2. Authorize your domain
Authentication → Settings → Authorized domains → Add domain: your production host
(e.g. `siravex.vercel.app`). Without this, Google login fails with
`auth/unauthorized-domain` (the app shows this exact hint on the login page).

## 3. Deploy Firestore rules (REQUIRED for admin)
Firestore Database → Rules → paste `firestore.rules` from this repo → Publish.
Or with CLI: `firebase deploy --only firestore:rules`.
Admin emails must match in BOTH places: `ADMIN_EMAILS` in
`src/services/firebase/firebase.ts` and the `isAdmin()` list in `firestore.rules`.

## 4. What gets stored
- `users/{uid}`: email, displayName, photoURL, lastSeenAt, lastIp, lastWatched
  {title, kind, group, at}, watchSessions, watchSeconds.
- `events/{id}`: watch events (uid, type, title, kind, group, time).
- `announcements/current`: admin-published banner {title, body, version, active}.
Stream URLs, tokens and passwords are NEVER written (tested in code).

## 5. Not included (needs your input)
- FCM push notifications: needs a Web Push VAPID key from
  Console → Project settings → Cloud Messaging. Paste it to the developer to enable.
