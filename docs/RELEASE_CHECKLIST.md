# Release checklist

## Repository readiness

- [ ] The repository is public and owned by the submitting GitHub account.
- [ ] GitHub Issues and private vulnerability reporting are enabled.
- [ ] The default branch contains `README.md`, `LICENSE`, `manifest.json`,
      `versions.json`, source code, and the package lock.
- [ ] Plugin ID `spherical-graph` and name `Spherical Graph` remain unique in
      the Community directory.
- [ ] The README disclosures still accurately describe payments, accounts,
      network use, external-file access, ads, telemetry, and source
      availability.

## Version preparation

- [ ] Choose an `x.y.z` version without a leading `v`.
- [ ] Update `manifest.json`, `package.json`, `versions.json`, and
      `CHANGELOG.md`.
- [ ] Run from a clean checkout:

```powershell
npm ci
npm run check
npm audit --omit=dev
git diff --check
```

- [ ] Perform the relevant scenarios in `MANUAL_TEST_PLAN.md`.
- [ ] Record the result in `VALIDATION.md`.

## GitHub release

- [ ] Commit and push the release preparation.
- [ ] Create and push a tag exactly matching `manifest.json`:

```powershell
$version = (Get-Content manifest.json | ConvertFrom-Json).version
git tag $version
git push origin $version
```

- [ ] Wait for the **Release Obsidian plugin** workflow.
- [ ] Confirm the draft release contains non-empty `main.js`, `manifest.json`,
      and `styles.css`.
- [ ] Confirm the workflow's build provenance attestation is present.
- [ ] Review generated notes and publish the draft release.

## Community directory

- [ ] For a first submission, sign in at <https://community.obsidian.md>, link
      the repository owner, choose **Plugins → New plugin**, and submit
      `https://github.com/Pavel-mik/obsidian-spherical-graph`.
- [ ] For an existing listing, verify the current description and screenshots
      in the Community developer dashboard.
- [ ] Address automated review feedback by incrementing the plugin version and
      publishing a new matching GitHub release.

Do not create a pull request to `obsidianmd/obsidian-releases`; new plugins are
submitted through the Community directory.
