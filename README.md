# Tiny Doodle

A tiny, resizable doodle/drawing desktop app for Windows.

## Features
- Starts small (sticky-note size, ~180x220px) but is freely resizable — drag any edge/corner
- Pen tool with adjustable brush size (1–60px)
- Eraser tool (separate from pen, also size-adjustable)
- Opacity slider (5–100%)
- 8 quick color swatches + a custom color picker
- Clear canvas button
- Pin button (📌) — toggles "always on top" so it floats over other windows
- Custom minimal title bar (drag to move, minimize, close) — no bulky OS window frame
- Drawing is preserved correctly when you resize the window

## How to build the Windows .exe

You need [Node.js](https://nodejs.org) installed (LTS version is fine).

1. Open this folder in a terminal (PowerShell or Command Prompt).
2. Install dependencies:
   ```
   npm install
   ```
3. Build the Windows installer:
   ```
   npm run dist
   ```
4. When it finishes, look in the `dist` folder — you'll find an installer like
   `Tiny Doodle Setup 1.0.0.exe`. Run that to install the app normally
   (Start Menu shortcut + Desktop shortcut included).

## Run without building (dev mode)

If you just want to try it first without making an installer:
```
npm install
npm start
```

## Notes
- The eraser truly erases (transparent), it doesn't just paint white — so it works
  no matter what color background you're doodling over.
- The opacity slider applies to the pen only; the eraser always erases at full strength.
- The window remembers its drawing when resized — it won't get stretched or cleared.
- Pin (📌) toggles "always on top." Click it again to un-pin.
