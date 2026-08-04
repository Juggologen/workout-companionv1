# Putting this on your friends' phones

The app is static files — no server, no build step, no database. That makes
hosting it easy and free, and updating it a `git push`.

Everyone's data (1RMs, sessions, log) lives in **their own browser** on **their
own phone**. Nothing is uploaded and nobody can see anyone else's training.
The flip side: there is no sync between devices, and clearing browser data
clears the log. The Log screen has an Export backup button for that.

---

## Where the project lives

Keep it **out of any synced folder** (OneDrive, Dropbox, iCloud). Git and the
sync client both want to manage the same files, and the sync client will
eventually copy a half-written `.git` object and corrupt the repository.

This project lives in `C:\dev\workout-companion`. Everything below assumes you
are in that folder.

Note that moving it out of OneDrive means OneDrive is no longer backing it up.
Pushing to GitHub (below) is what replaces that — until you do, the only copy
is this machine.

---

## 1. Commit

The repository is initialised, committed, and the identity is set locally for
this repo only (your global git config was left alone).

Subsequent changes:

```bash
git add -A
git commit -m "what changed"
```

---

## 2. The GitHub repository

This project pushes to:

```
https://github.com/Juggologen/workout-companionv1
```

> **The repository must be public.** GitHub Pages does not publish from a
> private repository on the free plan — you get a 404 at the Pages URL, and so
> does everyone you send it to. If it is private:
> **Settings → General → scroll to Danger Zone → Change repository visibility
> → Make public.**
>
> Nothing personal is committed. The tracked files were checked and contain no
> email address, username, machine path or training data.

---

## 3. Turn on Pages

In the repository: **Settings → Pages → Source: Deploy from a branch**, branch
`main`, folder `/ (root)`. Save.

A minute later the app is live at:

```
https://juggologen.github.io/workout-companionv1/
```

The URL follows the **repository name**, so the `v1` is part of it. The
username is lower-cased automatically.

That URL is what you send your friends. HTTPS comes free, which matters — a
service worker (and therefore offline use and home-screen install) only works
over HTTPS.

The `.nojekyll` file at the root tells Pages to publish the files as they are
rather than running them through Jekyll, which it would otherwise do by
default.

---

## 4. Installing it on a phone

Send the link. Then:

**Android / Chrome** — a banner offers "Install app". If it does not appear:
menu (⋮) → *Add to Home screen*.

**iPhone / Safari** — Share button → *Add to Home Screen*. It must be Safari;
Chrome on iOS cannot install web apps.

Either way it lands as an icon, opens without browser chrome, and works with no
signal after the first visit.

---

## 5. Updating it

```bash
git add -A
git commit -m "what changed"
git push
```

Pages rebuilds in under a minute. Friends get the new version the next time
they open the app with a connection — the service worker fetches from the
network first and only falls back to its cache when offline, so nobody gets
stuck on an old copy.

If you change which files exist, bump `VERSION` in `sw.js` so the old cache is
purged.

### Changing the exercise data

The workbook is still the source of truth:

1. Edit `Gym Exercise Compendium.xlsx` in Excel.
2. Regenerate the JSON:

```bash
powershell -ExecutionPolicy Bypass -File tools/extract-workbook.ps1
```

3. Commit and push as above.

---

## Alternatives to GitHub Pages

| Option | Good for | Updating |
|---|---|---|
| **GitHub Pages** | The default. Free, HTTPS, version history. | `git push` |
| **Netlify Drop** (<https://app.netlify.com/drop>) | No git at all — drag the folder onto the page. | Drag the folder again |
| **Cloudflare Pages** | Same as Pages, faster in some regions. | `git push` |

Netlify Drop is the fastest way to get a link in front of someone in the next
two minutes; GitHub Pages is the one worth keeping.

---

## If you later want a real APK

The app is already offline-first, so wrapping it needs no rewrite — but it does
need Node.js, which this machine does not have:

```bash
npm install -D @capacitor/cli @capacitor/core @capacitor/android
npx cap init "Workout Companion" com.adacti.workout --web-dir=.
npx cap add android
npx cap open android      # builds the APK in Android Studio
```

Worth doing only if you want it in a store or need something the browser cannot
do. For sharing with friends, the installed web app is the same experience
without the signing and distribution work.

---

## Troubleshooting

**A friend sees an old version.** Have them close and reopen the app while
online. If it persists, they can clear the site data, or you can bump `VERSION`
in `sw.js` and push.

**You want the service worker out of the way while developing.** In DevTools →
Application → Service Workers, tick *Update on reload*, or *Unregister*.

**The page is blank on GitHub Pages.** Almost always a path case mismatch —
Windows is case-insensitive, the server is not. Check that `src/`, `data/` and
`icons/` are lower-case in both the repository and the HTML.
