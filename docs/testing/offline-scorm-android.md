# Offline SCORM on Android Chrome

The local Android path exercises the real Upskill application, learning
runtime, package host, service workers, IndexedDB and offline lifecycle without
public DNS, a Public Suffix List submission or a locally trusted certificate.
It is a local qualification path; it does not qualify public DNS, wildcard TLS
or production Private PSL integration. Safari package-site storage also remains
a separate production-style HTTPS qualification; this path targets Android
Chrome.

## Prerequisites

- Node.js 26 and pnpm 11
- the normal local PostgreSQL, object storage and queue dependencies
- one Android device with Chrome and USB debugging enabled
- Android platform tools (`adb`) available either on `PATH` or through
  `UPSKILL_ADB_PATH`

No administrator access, root access, Keychain change or `/etc/hosts` entry is
required. Android must authorize the laptop when prompted for USB debugging.

## Run

Prepare the normal local database and seed data, connect and unlock the device,
then run:

```sh
pnpm run preview:offline-scorm:android
```

The command builds the application, creates ephemeral local-only signing and
origin keys, starts one loopback listener on port 8080, installs an ADB reverse
rule, and opens `http://app.localhost:8080` in Android Chrome. The related
origins are:

- `http://app.localhost:8080`
- `http://learn.localhost:8080`
- `http://p-<opaque-id>.localhost:8080`

Use `UPSKILL_ANDROID_PORT` to select another unprivileged port. Press Ctrl-C to
stop the server and remove the reverse rule.

The `localhost` package-site exception is accepted only in `development` and
`test`. Production continues to require HTTPS and a private Public Suffix List
entry. Staging rejects Offline SCORM activation even if
`OFFLINE_SCORM_ENABLED=true` is supplied.
