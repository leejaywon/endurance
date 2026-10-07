# Development

Follow the style guide in [AGENTS.md](../AGENTS.md).

## Running

From the repository root:

```sh
bun install
bun run dev:desktop   # Electron app, named "endurance Dev"
bun dev serve         # headless API server on port 4096
bun run dev:web       # web app; start the API server first
bun dev <directory>   # terminal UI in a directory
```

To package the desktop app:

```sh
bun run --cwd packages/desktop build
bun run --cwd packages/desktop package
```

After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. To regenerate the legacy JavaScript SDK, run `./packages/sdk/js/script/build.ts`.

### Debugging

Run with `bun run --inspect=ws://localhost:6499/ dev ...` and attach a debugger to that URL. To debug the server separately, start it with `bun run --inspect=ws://localhost:6499/ --cwd packages/opencode ./src/index.ts serve --port 4096`, then attach the terminal UI with `opencode attach http://localhost:4096`. Example VS Code configurations are in [.vscode](../.vscode).

## Project identity and compatibility

- Desktop names are `endurance`, `endurance Beta`, and `endurance Dev`, with `io.github.leejaywon.endurance` identifiers (`.beta` and `.dev` variants) and separate settings directories. Existing OpenCode settings are not copied.
- Desktop links use `endurance-app://`. Release metadata targets `leejaywon/endurance`; automatic updates are disabled until a release pipeline is tested.
- Internal `@opencode-ai/*` package names, backend configuration conventions, and `OPENCODE_*` environment variables are unchanged from the inherited codebase. Product artwork, menus, and repository support links use ENDURANCE. OpenCode Zen/Go provider labels, CLI/server names, and upstream license credits retain their original identity.

## Validation

Run `bun typecheck` from each affected package directory, never from the root. Tests also run from package directories.

For browser coverage of the endurance-specific features, run from `packages/app`:

```sh
bun run typecheck:e2e
bun run test:e2e \
  e2e/project-sidebar.spec.ts \
  e2e/voice-input.spec.ts \
  e2e/voice-recovery.spec.ts \
  e2e/regression/ollama-model-settings.spec.ts \
  e2e/regression/voice-settings-organisation.spec.ts \
  e2e/regression/session-composer-resize.spec.ts \
  e2e/regression/session-timeline-reasoning-projection.spec.ts \
  --workers=1
```

These tests use controlled server responses and synthetic microphone input. Real transcription quality, native microphone prompts, managed-model installation, and packaged builds need checks on the target device. Voice-specific checks are in [voice.md](voice.md#automated-checks).

ENDURANCE does not fetch the upstream desktop changelog. Set `VITE_ENDURANCE_CHANGELOG_URL` at build time only when an ENDURANCE release feed is available.
