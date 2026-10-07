# ENDURANCE desktop icons

The product mark is the original vector in `docs/assets/endurance-mark.svg`.

To regenerate the desktop icons and shared web favicons, install ImageMagick and Playwright Chromium (`bunx playwright install chromium` from `packages/app`), then run from the repository root:

```sh
bun packages/app/script/generate-product-icons.ts
```

The development, beta, and production variants use blue, violet, and charcoal backgrounds. Each variant includes PNG, ICO, and ICNS output. The generator creates an inset `dock.png` for unpackaged Electron on macOS. `scripts/copy-icons.ts` copies the selected channel to the ignored `resources/icons` build directory.

The inherited Tauri Android/iOS and Windows Store assets are unused by the Electron app and have been removed.
