# Releasing

A release is asked for by the commit that should be released. The workflow is
`.github/workflows/release.yml`; the check that reads the commit message is
`scripts/release-plan.mjs`.

## Making a release

```sh
node scripts/version.mjs --apply           # stamp yy.mm.dd.build
node scripts/release-plan.mjs "release:all"  # optional: what the push will do
git commit -am "release:all 26.09.29.10"
git push
```

| First line of the head commit | Result |
|---|---|
| `release:web …` | Tests, then the web build replaces <https://laisiangtho.github.io/> |
| `release:desktop …` | Tests, then installers for macOS, Windows and Linux on a GitHub release tagged `v<version>` |
| `release:all …` | Both |
| anything else | No release; `check.yml` runs as on any push |

Only pushes to `master` release, and only the head commit's first line is read
— with a squash merge, the pull request title. The same choice is under
**Actions → release → Run workflow**.

What the workflow refuses, and why:

- **A stamp the files disagree about.** `app/version.js`, `package.json` and
  `electron-builder.yml` are all written by `scripts/version.mjs --apply`; a
  release from files edited by hand would report one version and install
  another.
- **A tag that already exists on another commit.** The desktop update check
  compares the latest release's tag with the running version, so a second
  release under one tag would be invisible to every installed copy. Restamp and
  push again. A tag on the *same* commit means that release is already made —
  GitHub occasionally delivers one push twice, and the second run waits until
  the first has published — so that run skips the desktop release with a notice
  and succeeds.
- **A missing deploy key** for a web release (below).

A desktop release is a **draft** until all three installers are attached, then
published in one step. The update check reads `releases/latest`, which never
returns a draft, so no installed copy is offered an update whose download is
missing. If a run fails part way, running it again reuses the draft.

## Artifacts

| Platform | Files | First run |
|---|---|---|
| Windows | NSIS installer `…-win-x64-setup.exe` and a portable `…-win-x64-portable.exe`, both `x64` | Unsigned: SmartScreen warns; *More info → Run anyway*. |
| macOS | `.dmg` and `.zip`, `arm64` and `x64` | Ad-hoc signed only, not notarized: refused on first open until *System Settings → Privacy & Security → Open Anyway*, or `xattr -cr "/Applications/Lai Siangtho.app"`. |
| Linux | AppImage, `.deb`, `.rpm`, `.tar.gz`, `x64` | Nothing to allow. |

File names carry the stamped version: `lai-siangtho-26.9.29.11-mac-arm64.dmg`.
The release is titled with its tag (`v26.09.29.11`). Its notes are the commits
since the previous release tag, one line each with a short hash, leaving out
merges and the `release:` commits, followed by a collapsed paragraph on first
running an unsigned download (`scripts/release-notes.mjs`; run it locally to see
the notes the next release would get).

Linux formats, and why there are four:

- **AppImage** — one file for any distribution. Built with the 1.0.x AppImage
  runtime (`toolsets.appimage` in `electron-builder.yml`), which carries its
  own FUSE library. The default runtime needs `libfuse.so.2`, absent from
  Ubuntu 22.04+ and Fedora, and fails there with
  `dlopen(): error loading libfuse.so.2`. Its launcher keeps the Chromium
  sandbox on where user namespaces work and turns it off where they do not —
  Ubuntu 24.04+ restricts them to programs with an AppArmor profile, which an
  AppImage cannot install.
- **.deb / .rpm** — installed by the system's own installer, with a menu entry
  and an uninstaller. The `.deb` installs that AppArmor profile, so the sandbox
  stays on under Ubuntu 24.04+. The package revision is `buildNumber`, so a
  second build on one day (`26.9.29-11` after `26.9.29-10`) installs as an
  upgrade. The maintainer address in `electron-builder.yml` ships in both.
- **.tar.gz** — the application folder, for anything else.

Window frame: macOS and Windows draw the app's own title band with the system
buttons over it; Linux keeps the system title bar (see
`targets/desktop/electron/window.js`).

## One-time setup: the web deploy key

The web build is pushed to a different repository,
`laisiangtho/laisiangtho.github.io`. The token every workflow run receives
(`GITHUB_TOKEN`) is created automatically and needs no setup, but it can only
write to the repository the workflow runs in. A deploy key grants write access
to exactly one repository and nothing else.

1. **Generate a key pair** on any machine. No passphrase: the workflow has no
   way to enter one.

   ```sh
   ssh-keygen -t ed25519 -N "" -C "lab release → laisiangtho.github.io" -f pages_deploy
   ```

   This writes `pages_deploy` (private) and `pages_deploy.pub` (public).

2. **Public half on the site repository.** In `laisiangtho/laisiangtho.github.io`:
   *Settings → Deploy keys → Add deploy key*. Title `lab release`, paste the
   contents of `pages_deploy.pub`, tick **Allow write access**, add.

3. **Private half on this repository.** In `laisiangtho/lab`:
   *Settings → Secrets and variables → Actions → New repository secret*. Name
   `PAGES_DEPLOY_KEY`, paste the whole of `pages_deploy`, including the
   `-----BEGIN` and `-----END` lines.

4. **Delete both local files.** GitHub holds the only copies that are needed;
   a lost key is replaced by generating a new pair and repeating steps 2–3.

5. **Pages on the site repository.** In `laisiangtho/laisiangtho.github.io`:
   *Settings → Pages → Build and deployment*: source **Deploy from a branch**,
   branch **master**, folder **/ (root)**.

6. **Workflow permissions on this repository.** In `laisiangtho/lab`:
   *Settings → Actions → General → Workflow permissions*. The workflow asks for
   `contents: write` itself only in the jobs that create the release; if the
   organisation restricts workflows to read-only and forbids raising it,
   release creation fails with a 403 and this setting is the cause.

The first `release:web` after this replaces the site's contents with the build,
keeping only `LICENSE` and a `CNAME` if one is added later. A custom domain is
set by adding that `CNAME` to the site repository by hand; the deploy leaves it
in place.

## Signing later

- **macOS:** with an Apple Developer ID, export the certificate as `.p12`, add
  it as `CSC_LINK` (base64) and `CSC_KEY_PASSWORD` secrets, pass them to the
  *Package* step, remove `identity: "-"` and set `hardenedRuntime: true` in
  `electron-builder.yml`, and add notarization (`APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). The release-note paragraph
  about quarantine then goes.
- **Windows:** a code-signing certificate goes in as `WIN_CSC_LINK` and
  `WIN_CSC_KEY_PASSWORD` in the same way.
