# Virtual cockpit assets

Converted by `tools/fs9_vc.py` from the virtual cockpit of the **FSX Bombardier Learjet 60** by Premier Aircraft Design
(Jean-Pierre Brisard, Barry Blaisdell, Bob May & Kevin Pardy; model `lear60_ver25.mdl`, textures from the `N838` livery).

- `vc.json` — animated node tree (FS sim-variable tracks), batches (texture, material, index range)
- `vc.bin` — float32 vertices (position, normal, uv; metres, x right / y up / z forward) then uint16 indices
- `*.webp` — the DXT textures decoded

The live instruments drawn over the panel (`js/hud.js`, `js/vcgauges.js`) are our own; the model's gauges (`.gau`) are not used.
