# Virtual cockpit assets

Converted by `tools/fs9_vc.py` from the virtual cockpit of the **FSX Bombardier Learjet 60** by Premier Aircraft Design
(Jean-Pierre Brisard, Barry Blaisdell, Bob May & Kevin Pardy; model `lear60_ver25.mdl`, textures from the `N838` livery).

- `vc.json` — animated node tree (FS sim-variable tracks), batches (texture, material, index range)
- `vc.bin` — float32 vertices (position, normal, uv; metres, x right / y up / z forward) then uint16 indices
- `*.webp` — the DXT textures decoded

The package these were taken from carries an MIT licence notice:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
> documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
> rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
> persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice
> and this permission notice shall be included in all copies or substantial portions of the Software.
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

The live instruments drawn over the panel (`js/hud.js`, `js/vcgauges.js`) are our own; the model's gauges (`.gau`) are not used.
