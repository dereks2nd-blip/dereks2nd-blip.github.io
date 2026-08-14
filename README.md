# Derek Song — portfolio

Personal site. Plain HTML, CSS, and JavaScript with no build step, no framework,
and no dependencies beyond three.js from a CDN.

**Live:** https://dereks2nd-blip.github.io/

## What's interesting in here

The background is a single three.js scene rendered entirely as ASCII text, and
scroll position drives the camera: the page opens above a floating island in
daylight and descends a stone shaft as you read, with the ink shifting from
grass-green to torchlight along the way.

The ASCII is **not** three's `AsciiEffect`. That builds the character grid as DOM
text and rewrites its `innerHTML` every frame, which for a full-viewport scene
means tens of thousands of layout-bearing cells per frame — it could be detailed
or smooth, never both. `ascii.js` instead renders the scene into an offscreen
buffer sized one pixel per character cell, reads brightness back with
`gl.readPixels`, and paints one `fillText` per row onto a 2D canvas. That's ~66
draw calls a frame instead of ~14,000 DOM nodes, and it touches layout zero times.

## Files

| File | Role |
| --- | --- |
| `index.html` | Structure and all real content |
| `style.css` | Everything visual, including the Minecraft-flavored animations |
| `ascii.js` | The canvas ASCII renderer, voxel geometry builders, math helpers |
| `world.js` | Wires the scroll-driven world and the project card thumbnails |
| `kinetic.js` | Scroll reveals, the card materialize effect, ASCII wave dividers |
| `script.js` | World-gen intro and nav highlighting (classic script, no modules) |

## Running it locally

`world.js` is an ES module, so **opening `index.html` by double-clicking it will
not work** — modules are blocked on `file://`. Serve the folder over HTTP:

```bash
npx serve .
```

Then open the URL it prints. Any static file server works; the site needs no
build step, so there is nothing to compile first.
