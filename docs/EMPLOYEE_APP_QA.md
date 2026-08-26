# VYRON CORE Employee App — QA testing

Everything needed to install the app on an Android phone and work through
acceptance testing. Nothing here touches production.

## What this environment is

| | QA (this document) | Production |
|---|---|---|
| App | `http://192.168.101.175:3100` — your PC on the LAN | `https://vyron-core-rr-pilot.vercel.app` |
| Supabase | local Docker on the same PC | `gpiqkwebizuqajgaoxhm` |
| Data | disposable, seeded by the QA scripts | real |
| Config | `.env.rr-qa.local` | Vercel environment variables |

The APK points at the QA address **deliberately**, so nothing you do while
testing can create production jobs, incidents, or device registrations. The
production build never contains a LAN or localhost address — see *Environment
separation*.

## Before you start

On the PC:

- Docker running, with local Supabase up (`npx supabase start`)
- `.env.rr-qa.local` present in the repo root
- Phone and PC on the **same Wi-Fi**

If your PC's LAN address is not `192.168.101.175`, see *If your IP is different*.

## 1. Start the QA server

```bash
cd /c/Users/gerha/vyron-core-web
set -a; . ./.env.rr-qa.local; set +a
export NEXT_PUBLIC_SUPABASE_URL="http://$RR_QA_HOST:54321"
npx next build
npx next start -H 0.0.0.0 -p 3100
```

Two details matter here.

`-H 0.0.0.0`: without it the server listens only on loopback and the phone
cannot reach it at all.

The `NEXT_PUBLIC_SUPABASE_URL` override: that value is compiled into the
JavaScript the phone runs, and the phone talks to Supabase **directly**. Left at
`127.0.0.1` it would tell the phone to look for Supabase on the phone itself.
The default in `.env.rr-qa.local` is loopback because the browser test suites run
on this PC; the override is what makes the build servable to a device.

Check from the PC's browser: `http://192.168.101.175:3100/login` should load.

## 2. Let the phone through the firewall

Windows Firewall blocks inbound 3100 by default. Once, as Administrator:

```powershell
New-NetFirewallRule -DisplayName "VYRON CORE QA app" -Direction Inbound -LocalPort 3100 -Protocol TCP -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "VYRON CORE QA supabase" -Direction Inbound -LocalPort 54321 -Protocol TCP -Action Allow -Profile Private
```

Both ports are needed: 3100 serves the app, 54321 is Supabase, and the phone
talks to both directly.

## 3. Install the APK

Copy `VYRON-CORE-employee-app-debug.apk` from the Desktop to the phone and open
it. Android asks you to allow installing from this source — expected for a build
that does not come from the Play Store.

Then open **VYRON CORE** from the app drawer.

## 4. Sign in

Use a QA account that exists in the local Supabase. The app opens straight at
the sign-in screen rather than the public marketing site.

The sign-in page still carries the website's own navigation, so it is possible to
wander onto the marketing pages from there. Nothing protected is exposed by that
— those pages are public — but if you end up on "Book a Demo", reopen the app and
you will be back at sign-in.

## If your IP is different

Find it with `ipconfig` (IPv4 Address on the Wi-Fi adapter), then update the one
line in `.env.rr-qa.local` that names it:

```
RR_QA_HOST=<your-ip>
```

Leave `NEXT_PUBLIC_SUPABASE_URL` and `RR_QA_APP_URL` on loopback — those are what
the browser test suites use, and the device build overrides the Supabase URL from
`RR_QA_HOST` when you start the server.

and rebuild the APK:

```bash
export VYRON_APP_URL="http://<your-ip>:3100"
npx cap sync android
cd android && ./gradlew assembleDebug
```

You must also add the new address to the debug network config, or Android will
block the plaintext connection before the app ever sees it:

`android/app/src/debug/res/xml/network_security_config.xml`

```xml
<domain includeSubdomains="false">YOUR-IP-HERE</domain>
```

That file applies to **debug builds only** — the release build permits no
cleartext at all, so this can never weaken a production APK.

`127.0.0.1` will **not** work: on the phone that address means the phone itself.

## Environment separation

A production build cannot depend on a QA address, and this is enforced by where
the values come from rather than by remembering:

- `capacitor.config.ts` reads `VYRON_APP_URL` and falls back to the **production
  HTTPS origin**. A LAN address appears only when that variable is set.
- `NEXT_PUBLIC_SUPABASE_URL` is inlined at build time from the environment. The
  QA value lives only in `.env.rr-qa.local`, which is gitignored.
- `android/app/src/main/res/xml/network_security_config.xml` permits cleartext
  HTTP for the QA hosts **only**. Every other host must be HTTPS, so a
  production build cannot silently fall back to plaintext.

---

# Acceptance checklist

Tick what passes. For anything that fails, note what you saw and where.

## Authentication

- [ ] Login with a valid QA account
- [ ] Invalid login refused, with a message that makes sense
- [ ] Session persists — fully close the app and reopen; you stay signed in
- [ ] Logout (More → Sign out)
- [ ] Sign out is refused while reports are still waiting to send, and says how many
- [ ] Re-login after logout
- [ ] After signing out, a second employee signs in and sees none of the first
      employee's work

## Home

- [ ] Home loads
- [ ] Shows the right employee
- [ ] Work summary correct
- [ ] Incident summary correct
- [ ] Inbox count correct
- [ ] Connection status matches reality (Online / No connection)

## Work

- [ ] Work tab opens
- [ ] Assigned jobs appear
- [ ] Job details open
- [ ] The primary action is obvious and works
- [ ] Requirements checklist behaves
- [ ] Evidence can be attached
- [ ] GPS captured

## Incidents

- [ ] Create an incident
- [ ] Category
- [ ] Severity
- [ ] Description
- [ ] GPS recorded
- [ ] People involved
- [ ] Immediate danger asked **first**
- [ ] Emergency services question
- [ ] Attach more than one photograph
- [ ] Review screen shows what you entered
- [ ] Saved on the device
- [ ] Submit

## Offline

Aeroplane mode on for this section.

- [ ] Create an incident with no connection
- [ ] Take a photograph with no connection
- [ ] Force-close the app and reopen, still offline
- [ ] The incident is still there
- [ ] The photographs are still there
- [ ] Aeroplane mode off
- [ ] It syncs on its own, without pressing anything
- [ ] It appears **once**
- [ ] No duplicate after reopening the app again

## Inbox

- [ ] Notifications appear
- [ ] Opening one goes to the right item
- [ ] A notification for something that no longer exists is refused cleanly
- [ ] A notification for another company's record is refused

## Road & Recovery

- [ ] Job alerts appear
- [ ] My Jobs
- [ ] Accept
- [ ] Decline
- [ ] Start travel
- [ ] Arrive
- [ ] GPS validated on arrival
- [ ] GPS exception handled when the fix is poor
- [ ] Evidence capture
- [ ] BYSTAND clock
- [ ] Report
- [ ] Stand-down

## Security

- [ ] Another company's data is never visible
- [ ] Sign out, sign in as a different employee — none of the first employee's
      work is visible
- [ ] After logout nothing protected is left on screen

---

## Known limitations in this build

- **Push notifications** are not delivered. Registration, hand-over on a shared
  handset, and revocation all work and are tested; delivery needs Firebase
  credentials this environment does not have.
- **iOS** is prepared but not built. It needs macOS, Xcode, and a paid Apple
  Developer account.
- **Offline cold start** shows a VYRON CORE offline screen rather than the full
  app. Queued work is safe and sends itself once signal returns, and the app
  reloads itself without you doing anything.
