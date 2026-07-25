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
git tag 1.0.0
git push origin 1.0.0
```

- [ ] Wait for the **Release Obsidian plugin** workflow.
- [ ] Confirm the draft release contains non-empty `main.js`, `manifest.json`,
      and `styles.css`.
- [ ] Confirm the workflow's build provenance attestation is present.
- [ ] Review generated notes and publish the draft release.

## First Community directory submission

- [ ] Sign in at <https://community.obsidian.md>.
- [ ] Link the GitHub account that owns the repository.
- [ ] Choose **Plugins → New plugin**.
- [ ] Submit
      `https://github.com/Pavel-mik/obsidian-spherical-graph`.
- [ ] Accept the current Developer policies and maintenance commitment.
- [ ] Address automated review feedback by incrementing the plugin version and
      publishing a new matching GitHub release.

Do not create a pull request to `obsidianmd/obsidian-releases`; new plugins are
submitted through the Community directory.
