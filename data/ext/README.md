# Exterior model assets

Converted by `tools/fs9_ext.py` from the exterior model of the **FSX Bombardier Learjet 60** by Premier Aircraft Design
(Jean-Pierre Brisard, Barry Blaisdell, Bob May & Kevin Pardy; model `lear60_ver25.mdl`, textures from the `N838` livery).

- `ext.json`: animated node tree (FS sim-variable tracks), batches (texture, material, index range, tags), notes
- `ext.bin`: float32 vertices (position, normal, uv; metres, x right / y up / z forward), then uint16 indices
  (uint32 if `"index32": true`)
- `*.webp`: the DXT textures, decoded

Same layout as `data/vc` (node `p`/`var`/`type`/`keys`/`m`, batch `node`/`tex`/`diffuse`/`first`/`count`), so the
`track()`/`quatM`/`pose()` code in `js/cockpit.js` drives it unchanged. The model has one exterior level of detail.
21,916 vertices, 23,972 triangles, 110 batches, 66 animated nodes.

## Frame and size

The origin is the FS reference point (x right, y up, z forward), the same as the VC, so the two line up.
Rest-pose bounds: x ±6.40, y −1.01 … 2.86, z −9.17 … 8.96 m. That is 18.12 m long (nose to elevator trailing
edge), 12.80 m span, and 3.87 m tall with the gear up or 4.44 m with the gear down. The real aircraft is 17.88 m long,
13.34 m in span and 4.47 m tall.

From `aircraft.cfg`: the station datum is 34.5 ft (10.52 m) ahead of the reference point, so z = 10.516 − 0.3048 × station.
- Nose tip: 8.955 m ahead of the reference point, which puts the datum 1.56 m ahead of the nose.
- Empty-weight CG (−35.79 ft): z = −0.39 m, on the centreline at y = 0.
- Engines (−50 ft, ±4.3 ft): z = −4.72 m, x = ±1.31 m. Pilot eyepoint: (−0.49, 0.61, 5.43) m.
- Gear contact points: nose at z 6.95 m, mains at z −0.92 m and x ±1.45 m; y −1.60 / −1.67 m.
  The wheel bottoms are at y −1.59 with the gear fully down (t 100).
- The light positions in the cfg match the lens geometry in the model.

## Rendering notes

- Triangles are one-sided. In index order (a, b, c), cross(b − a, c − a) points against the outward normal
  (D3D clockwise). Cull back faces: the exterior has inward-facing cockpit and cabin shells that lie almost on the
  skin and show through it otherwise.
- Glass: batches with `"glass": true` (diffuse alpha 0.39 for the windows, 0.20 for the wingtip nav-light covers).
  Opacity comes only from the diffuse alpha. Texture alpha on these DXT3 textures is the FS reflection/specular mask
  (255 = no reflection), never opacity; see `texture_alpha` in the json.
- Tagged batches: `"tag": "nav"` / `"beacon"` are the self-lit light lenses (wingtip red/green, tail white, belly and
  tail beacons; drawn only with those lights on in FS). `"tag": "crew"` is the two pilot figures.
- The texture `others.bmp` is not in any livery folder. Its 538 triangles (the cockpit interior shell) are written
  untextured with their material colour.
- Left out: the landing-light halos (the view-mode 0x10 branch and the 0xB2 effects), the gear-leg landing/taxi
  lenses (gear down and lights on only), the spinning-fan blur discs (stopped fan blades are kept), and an
  option-gated alternative nose piece lying in the radome.

## Animated nodes (`var` → part)

`t` is the keyframe time. Untouched nodes rest at t 0, except the control surfaces, which rest at t 50.

| var | part | t |
|---|---|---|
| 152 / 156 / 160 | left main / right main / nose gear, with legs, wheels and doors | 0 retracted (gear up, doors shut), 100 down and locked, 100–200 oleo compression |
| 440 / 444 | left / right flap | 0 up, 40 = 8°, 70 = 20°, 100 = 40° (the `flaps-position` detents) |
| 168 / 164 | left / right spoiler panel | 0 stowed, 100 ≈ 50° up |
| 176 / 172 | left / right thrust-reverser buckets | stowed over 0–100, deploy over 100–200 |
| 318 | main airstair door, forward left | 0 closed, 100 open |
| 338 | cockpit–cabin door (inside) | 0 closed |
| 110 / 112 | left / right aileron * | t = 50 + 50·ail (ail > 0 = roll right: left trailing edge down, right up), ±18° |
| 118 | elevator, both halves * | t = 50 + 50·elev (elev > 0 = pull: trailing edge up 17°; push: down 15.5°) |
| 120 | rudder * | t = 50 + 50·rud (rud > 0 = trailing edge right), ±30° |

\* `"vicall": true`. In the model these surfaces sit on 0x46 POINT_VICALL rotations driven by FS globals
(0x6E, 0x70, 0x76, 0x78), not on keyframe tracks. The converter turns them into three-key rotation tracks about the
hinge in the same quaternion format, mapped the same way as the VC yoke and pedals (`50 + 50 * control`).
Wheel spin (0x192/0x196/0x19A), fan spin (0xF4/0xF8) and nose-wheel steering (0x78 on the nose leg) are frozen at rest.
There is no separate elevator-trim part.
