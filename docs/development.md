# Development

## Run from source

```sh
npm install
npm test
```

Open the repository in VS Code and press ++f5++ to launch an Extension Development Host. Open your React Native project in that host, then expand **Devices** and **APKs** in Explorer.

## Package

```sh
npm run package
```

## Helper APK

Build the helper with `./helper-apk/build.sh`; this also refreshes `resources/mota-recorder.apk`. Run `npm test`, then `npm run package`. See `helper-apk/README.md` for the APK's standalone workflow. The extension package includes only the built helper APK; helper source, test APKs and the development signing key are excluded.

## Tests

`npm test` compiles TypeScript and checks discovery parsing, endpoint validation, safe HTML output, literal process arguments, metric conversion, recovery hints, install flag validation, and mocked VS Code interactions for install retries, saved connections and monitor controls. Physical-device QR pairing, installs, logcat and diagnostics require a manual device smoke test.

### Phone sharing

The code for sharing phones between sessions is in:

- `src/leases.ts`: the shared store in `~/.mota/devices.json`. It holds leases, busy work, lines, takeovers and notices, all written under a lock file.
- `src/ai/caller.ts`: works out which agent process is calling.
- `src/externalBusy.ts`: finds Maestro and instrumentation tests started outside MoTA.
- `src/rawCommands.ts`: decides which phones a shell command changes.
- `src/ai/hooks.ts` and `src/hookSetup.ts`: the Claude Code hooks.

`test/leases.test.js`, `test/externalBusy.test.js` and `test/hooks.test.js` cover them, including the real hook command against a local server. Try it with two real sessions as in [Share phones between AI sessions](sharing-phones.md#try-it).

## Docs

This site is built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) from the `docs/` folder and deployed to GitHub Pages by `.github/workflows/docs.yml` on every push to `main` that touches the docs. To preview locally:

```sh
pip install -r docs/requirements.txt
mkdocs serve
```

## References

- [ADB guide](https://developer.android.com/tools/adb)
- [ADB Wi-Fi architecture](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/adb_wifi.md)
- [VS Code extension API](https://code.visualstudio.com/api/references/vscode-api)
