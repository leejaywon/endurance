#!/usr/bin/env bun
import { $ } from "bun"
import path from "node:path"

// Chromium renders SVG consistently; ImageMagick exports PNG sizes and ICO.
// ICNS entries contain PNG data.
const root = path.resolve(import.meta.dir, "../../..")
const source = await Bun.file(path.join(root, "docs/assets/endurance-mark.svg")).text()
const { chromium } = await import("@playwright/test")
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 2 })
const temporary = path.join(root, "tmp/endurance-icons")
await $`mkdir -p ${temporary}`.quiet()
const chunks = (entries: { type: string; data: Buffer }[]) => {
  const blocks = entries.map((entry) => {
    const header = Buffer.alloc(8)
    header.write(entry.type)
    header.writeUInt32BE(entry.data.length + 8, 4)
    return Buffer.concat([header, entry.data])
  })
  const header = Buffer.alloc(8)
  header.write("icns")
  header.writeUInt32BE(8 + blocks.reduce((sum, block) => sum + block.length, 0), 4)
  return Buffer.concat([header, ...blocks])
}

for (const channel of ["dev", "beta", "prod"] as const) {
  const color = { dev: "#2155D8", beta: "#6750A4", prod: "#202020" }[channel]
  const svg = path.join(temporary, `${channel}.svg`)
  const artwork = source
    .replace(/#202020/g, "#F5F4F1")
    .replace(/#727272/g, "#A9A9AF")
    .replace('viewBox="0 0 48 48">', `viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="${color}"/><g transform="translate(6 6) scale(.75)">`)
    .replace("</svg>", "</g></svg>")
  await Bun.write(svg, artwork)
  await page.setContent(`<style>body { margin: 0 }</style>${artwork}`)
  const master = path.join(temporary, `${channel}-master.png`)
  await page.screenshot({ path: master, omitBackground: true })
  const folder = path.join(root, "packages/desktop/icons", channel)
  const entries = []
  for (const [size, type] of [[32, "icp5"], [64, "icp6"], [128, "ic07"], [256, "ic08"], [512, "ic09"], [1024, "ic10"]] as const) {
    const png = path.join(temporary, `${channel}-${size}.png`)
    await $`magick ${master} -resize ${size}x${size} -depth 8 ${png}`.quiet()
    entries.push({ type, data: Buffer.from(await Bun.file(png).arrayBuffer()) })
    if (size <= 128) await Bun.write(path.join(folder, `${size}x${size}.png`), Bun.file(png))
    if (size === 256) await Bun.write(path.join(folder, "128x128@2x.png"), Bun.file(png))
    if (size === 512) await Bun.write(path.join(folder, "icon.png"), Bun.file(png))
  }
  await Bun.write(path.join(folder, "icon.icns"), chunks(entries))
  await $`magick ${path.join(folder, "icon.png")} -define icon:auto-resize=256,128,64,48,32,16 ${path.join(folder, "icon.ico")}`.quiet()
  await $`magick ${path.join(folder, "icon.png")} -resize 208x208 -gravity center -background none -extent 256x256 ${path.join(folder, "dock.png")}`.quiet()
}

const favicon = path.join(root, "packages/ui/src/assets/favicon")
const svg = path.join(temporary, "favicon.svg")
await Bun.write(svg, source.replace(/#202020/g, "#F5F4F1").replace(/#727272/g, "#A9A9AF").replace('viewBox="0 0 48 48">', 'viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#202020"/><g transform="translate(6 6) scale(.75)">').replace("</svg>", "</g></svg>"))
await page.setContent(`<style>body { margin: 0 }</style>${await Bun.file(svg).text()}`)
const master = path.join(temporary, "favicon-master.png")
await page.screenshot({ path: master, omitBackground: true })
await browser.close()
for (const name of ["favicon.svg", "favicon-v3.svg"]) await Bun.write(path.join(favicon, name), Bun.file(svg))
for (const [name, size] of [["favicon-96x96.png", 96], ["favicon-96x96-v3.png", 96], ["apple-touch-icon.png", 180], ["apple-touch-icon-v3.png", 180], ["web-app-manifest-192x192.png", 192], ["web-app-manifest-512x512.png", 512]] as const) {
  await $`magick ${master} -resize ${size}x${size} -depth 8 ${path.join(favicon, name)}`.quiet()
}
await $`magick ${path.join(favicon, "favicon-96x96.png")} -define icon:auto-resize=64,48,32,16 ${path.join(favicon, "favicon.ico")}`.quiet()
await Bun.write(path.join(favicon, "favicon-v3.ico"), Bun.file(path.join(favicon, "favicon.ico")))
console.log("Generated ENDURANCE desktop icons and favicons.")
