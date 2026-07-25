# Contributing

Thanks for helping improve Spherical Graph.

## Before opening an issue

- Search existing issues first.
- Include your Obsidian version, operating system, plugin version, vault size,
  and the smallest reproducible sequence.
- Do not attach private notes or a real vault. Prefer the synthetic vault
  generator or anonymized metadata.
- Use the private process in [SECURITY.md](SECURITY.md) for vulnerabilities.

## Development

Use a disposable development vault and place the repository directly at:

```text
<vault>/.obsidian/plugins/spherical-graph/
```

Install and verify:

```powershell
npm ci
npm run check
```

Useful focused commands:

```powershell
npm run dev
npm run test
npm run test:coverage
npm run benchmark:layout
npm run generate:test-vault -- --output ./tmp/test-vault --nodes 500 --edges 1500 --seed 42 --pattern clustered
```

## Pull requests

- Keep changes focused and preserve the fixed-layout lifecycle.
- Never modify note contents or introduce telemetry, runtime network access,
  remote code, advertisements, or an updater.
- Add or update tests for behavior changes.
- Update user documentation and `CHANGELOG.md` when appropriate.
- Run `npm run check` before opening the pull request.
- Do not commit `main.js`; release automation builds it from source.

By contributing, you agree that your contribution is licensed under the
project's [MIT License](LICENSE).
