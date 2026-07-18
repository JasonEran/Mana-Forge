# Release Process

Mana separates a validated CI candidate from an authorized public release.
Merging a version-preparation PR does not create a tag, sign an executable, or
publish a GitHub Release.

## Current Signing Status

The v0.3.0 Windows candidate is unsigned. `windows-launcher/package.json`
keeps executable signing disabled because the project has no configured
Windows code-signing identity. Users should expect Windows reputation or
SmartScreen warnings. Do not describe an unsigned CI artifact as a signed or
trusted Windows release.

A stable public release requires either:

1. a configured, access-controlled code-signing certificate and successful
   signature verification; or
2. explicit maintainer approval to publish an unsigned prerelease with the
   limitation stated prominently in its release notes.

## Candidate Contract

Run from a clean commit on Windows with Node.js 22.12 or newer:

```powershell
node scripts/check-release-metadata.js

cd node-bot
npm ci
npm run test:full

cd ..\windows-launcher
npm ci
npm test
npm run dist
npm run verify:package
npm run verify:installer
npm run verify:branding
node ..\scripts\write-installer-checksum.js
```

The canonical outputs are:

- `windows-launcher/dist/Mana-Setup-0.3.0-x64.exe`
- `windows-launcher/dist/Mana-Setup-0.3.0-x64.exe.sha256`

The required GitHub `main` Quality gates run is the release-candidate source of
record. Download `mana-windows-installer` and `windows-quality-evidence` from
that same run so code, binary, checksum, lifecycle, package, and installer
evidence share one commit SHA.

## Verify A Candidate

On PowerShell, compare the downloaded installer with its checksum file:

```powershell
$installer = "Mana-Setup-0.3.0-x64.exe"
$expected = (Get-Content "$installer.sha256").Split()[0].ToLowerInvariant()
$actual = (Get-FileHash -Algorithm SHA256 $installer).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "Installer SHA-256 mismatch." }
```

Before promotion, confirm all of the following:

- the source commit is on `main` and the worktree is clean;
- PR DCO and every required Quality gate passed;
- Core target evidence passes every budget in `quality/budgets.json`;
- clean install, launch, Doctor, shutdown, and uninstall evidence passed;
- the installer filename and SHA-256 match version `0.3.0`;
- application and installer PE icon resources match the generated Mana ICO;
- the signing decision is recorded and independently verified.

## Public Release Authorization

Only after explicit maintainer authorization, validate the intended tag:

```powershell
$env:MANA_RELEASE_TAG = "v0.3.0"
node scripts/check-release-metadata.js
```

Create the tag from the exact validated `main` commit. Prefer a signed tag and
verify it before publishing. Attach the installer, checksum, and release notes
derived from `CHANGELOG.md`; link the successful Quality gates run and target
evidence. Never rebuild the installer from a different commit for the same tag.

## Rollback

Before publication, discard the candidate artifacts and revert the release
preparation merge commit if metadata or packaging is wrong.

After publication, do not move or reuse the tag. Mark the release withdrawn,
remove affected downloadable artifacts if distribution must stop, document the
reason, revert the faulty change on `main`, and issue a new patch version with
fresh validation and checksums. Runtime/data rollback remains owned by the
individual change Issues; v0.3.0 introduces no user-data schema migration.
