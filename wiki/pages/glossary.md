# Glossary

Aviation, weather and sim terms used across the code and this wiki, in alphabetical order. Where the sim uses a term
in a specific way, the definition says how. The leg types of ARINC 424 have their own table at the end.

## Terms

| Term | Meaning |
|---|---|
| **ABI** | Advanced Baseline Imager, the imager on GOES-19. The sim uses its visible band C02 and infrared band C13 for cloud tops |
| **AC 25.1329-1C** | FAA Advisory Circular on flight guidance systems. The sim's autopilot and flight director modes, annunciations and armed-mode behaviour follow it |
| **ACES** | The filmic tone map at the end of the render pipeline |
| **ADS-B** | Automatic Dependent Surveillance–Broadcast. The aircraft's reported position track, replayed in the reconstruction and drawn as the ghost track |
| **AFM** | Airplane Flight Manual. Here the Learjet 60 AFM, FM-123, whose Section V performance charts the model is validated against |
| **AGL** | Above ground level. In free flight, above the curved ground surface |
| **ALT** | Altitude hold, a vertical autopilot mode |
| **ALTS** | Altitude capture. Always armed; shown as ALTS CAP while capturing the preselected altitude |
| **APR** (engine) | Automatic performance reserve. Armed for takeoff; after an engine failure the live engine goes to APR thrust (4,600 lbf to 31.6 °C) |
| **APR** (guidance) | The approach button (`\`): arms the localizer or FMS final course and the glideslope or glidepath |
| **ARINC 424** | The industry standard for coding navigation data in fixed-column records. The FAA CIFP is ARINC 424-18 |
| **Armed mode** | A guidance mode waiting for its capture criteria, shown in white on the mode band. Active modes are green |
| **As flown** | The default difficulty: the autopilot trims hard and hands over the airplane trimmed nose-down. See also *Trainer* |
| **Buffet onset** | The lift coefficient at which shock-induced (high speed) or stall (low speed) buffet starts. Checked against AFM Fig 5-24 and SAE 932534 |
| **Category C** | The approach category for the Learjet 60, by its VREF at maximum landing weight (139 kt). The sim reads the Category C minimums |
| **CG** | Centre of gravity |
| **CHM** | Canopy height model: Meta and WRI's 1 m map of tree heights, the source of the trees around the impact area |
| **CIFP** | Coded Instrument Flight Procedures. The FAA's coding of every US instrument procedure, plus runways, ILS, navaids, waypoints and airways. Public domain, 28-day cycle |
| **CL, CLmax** | Lift coefficient, and its maximum before the stall. CLmax falls with Mach |
| **Cm** | Pitching-moment coefficient |
| **Curved datum** | The free-flight convention of measuring altitude above the curved ground surface, with gravity along its local vertical |
| **DA** | Decision altitude: the minimums of a precision or vertically guided approach (for example ILS 10L, DA 216 ft) |
| **DCT** | Direct, in a route string: fly straight to the next fix |
| **Design dive speed** | VD/MD. The sim uses 377 KIAS / M 0.89 (Vmo + 47 kt in every altitude band), an estimate consistent with Part 25 margins, because it isn't published |
| **DME** | Distance measuring equipment |
| **d-TPP** | The FAA's digital terminal procedures publication: approach plates and airport diagrams, public domain, 28-day cycle |
| **Dutch roll** | The coupled yaw and roll oscillation. Damped by the yaw damper |
| **EASA TCDS** | Type certificate data sheet. IM.A.212 covers the Learjet 60; its airspeed-limits chart gives the 20 VA points |
| **EFB** | Electronic flight bag: the tablet (Tab) with the moving map and procedure cards |
| **FAF** | Final approach fix |
| **FD** | Flight director: the single-cue (V-bar) pitch and bank commands on the PFD, with or without the autopilot (`\|`) |
| **FDR** | Flight data recorder. The sim records at 4 Hz, saves to the browser and exports CSV from the debrief |
| **FGC** | The flight-guidance mode strip on the 2D panel's glareshield |
| **FL** | Flight level: altitude in hundreds of feet on standard pressure (FL350 = 35,000 ft) |
| **FMS** | Flight management system. `js/fms.js` flies any ARINC 424 leg sequence and feeds LNAV and VNAV |
| **GA** | Go-around mode (`?`): pitch 10°, LNAV armed for the published missed approach |
| **Gamepad API** | The browser API the sim uses for yokes, sticks, pedals, quadrants and gamepads |
| **GLM** | Geostationary Lightning Mapper on GOES-19. Its flashes are replayed at their real times and places |
| **GOES-19** | NOAA's GOES-East geostationary weather satellite, source of the cloud tops and the lightning |
| **GP** | Glidepath: the vertical mode that flies an RNAV approach's final path |
| **GS** | Glideslope: the ILS vertical mode, captured from the glideslope signal |
| **HAT** | Height above touchdown, printed with the minimums on a plate |
| **HDG** | Heading select. Spin the bug past 180° and the airplane turns the way you spun it |
| **HSI** | Horizontal situation indicator: the compass rose on the PFD with the heading bug, course pointer and deviation bar |
| **ILS** | Instrument landing system: localizer plus glideslope. `js/nav.js` computes deviations for any ILS in the database |
| **ISA** | International Standard Atmosphere. The accident day was ISA+7 at FL350 |
| **ITT** | Interstage turbine temperature, the engine limit behind the thrust rating |
| **KAMX** | The Miami NEXRAD radar whose Level II volumes build the storm |
| **KCAS** | Calibrated airspeed in knots |
| **KDJT** | Palm Beach International's current FAA identifier, formerly KPBI |
| **KEAS** | Equivalent airspeed in knots. The debrief reports the peak |
| **KIAS** | Indicated airspeed in knots, what the speed tape shows |
| **KPBI** | Palm Beach International, the origin of the sim's coordinate frame. The accident scenario keeps this name |
| **KTAS** | True airspeed in knots |
| **LCFA** | Lightning Cluster-Filter Algorithm, the GLM Level 2 product the flashes come from |
| **LNAV** | Lateral navigation: the autopilot mode that follows the flight plan. Also an RNAV minimums line (MDA) |
| **LNAV/VNAV** | An RNAV minimums line with baro-VNAV vertical guidance (DA). The sim uses it on RNAV (GPS) approaches |
| **LOC** | Localizer: the ILS lateral signal, and the lateral mode that tracks it |
| **LPV** | An RNAV minimums line that needs WAAS. The Learjet 60 here has baro-VNAV, not WAAS, so it isn't used |
| **M, Mmo** | Mach number, and the maximum operating Mach, 0.81 (0.77 with the Mach trim inoperative) |
| **Mach trim** | The system that trims nose-up as Mach rises to counter Mach tuck. One hypothesis fails it |
| **Mach tuck** | The nose-down pitching moment at high Mach. In the sim its size is hand-set; only its ordering against the AFM Mach limits is checked |
| **MAP** | Missed approach point |
| **MCT** | Maximum continuous thrust. Max-continuous N1 is checked against AFM Fig 5-31 and 5-32 |
| **MDA** | Minimum descent altitude: the minimums of a non-precision approach (for example LOC 28R, MDA 460 ft) |
| **METAR** | A routine surface weather report. The sim uses the KPBI METARs of 1 November 2026 |
| **MFD** | Multi-function display: the weather radar screen on the panel |
| **Missed approach** | The published procedure after a go-around, flown by the FMS through LNAV, including its hold |
| **MTOW** | Maximum takeoff weight, 23,500 lb |
| **N1** | Fan speed, as a percentage. The thrust setting |
| **NAIP** | USDA National Agriculture Imagery Program orthophotos, served by USGS. The ground imagery |
| **NBAA IFR range** | A standard business-jet range mission with fixed reserves. The model flies 2,455 nm against 2,405 nm published |
| **NDB** | Non-directional beacon |
| **NED** | North, east, down: the physics frame, in metres from KPBI |
| **NEXRAD** | The US network of weather radars. Level II is the full-resolution volume data |
| **NHD** | USGS National Hydrography Dataset: the water polygons for the water masks |
| **ODbL** | Open Database License, the terms of the OpenStreetMap-derived building and boundary data |
| **Part 25** | The US airworthiness standards for transport-category airplanes. Source of the touchdown and structural limits |
| **PFD** | Primary flight display: attitude, speed and altitude tapes, VSI, mode band and HSI |
| **PID** | Physical Interface Device: the USB HID force-feedback protocol behind DirectInput force feedback |
| **Preselected altitude** | The altitude set with `<` `>`. VNAV never climbs or descends through it, except on final |
| **Pro Line 4** | The Collins avionics suite in the Learjet 60. The sim's PFD and mode band are styled after it |
| **PTM** | The FlightSafety Learjet 60 training manual, cited for stabilizer travel and APR thrust |
| **RF** | Radius-to-fix: a constant-radius curved leg |
| **RNAV** | Area navigation: approaches and routes defined by fixes rather than ground stations |
| **RNP** | Required navigation performance. RNP 0.30 is the minimums line used on RNAV (RNP) approaches |
| **RVR** | Runway visual range, part of the published minimums |
| **SID** | Standard instrument departure |
| **SLD** | Supercooled large droplets: the rapid icing in the combined hypothesis |
| **Stick shaker** | The stall warning that shakes the column. The Learjet 60 has no stick pusher |
| **STAR** | Standard terminal arrival route |
| **TAA** | Temporal anti-aliasing in the renderer |
| **TCH** | Threshold crossing height of a glideslope |
| **TO** | Takeoff mode: the flight director commands the AFM rotation attitude of +9° |
| **TOD** | Top of descent: where VNAV's descent path to the arrival constraints meets the cruise altitude |
| **TOGA** | Takeoff / go-around (`?`): TO mode on the runway, GA in the air |
| **Trainer** | The gentler difficulty: a slower autopilot auto-trim and no nose-down handover. Same airplane, same storm |
| **V1** | Takeoff decision speed, from AFM Fig 5-42 for your weight |
| **V2** | Takeoff safety speed, reached by 35 ft with an engine failed |
| **VA** | Maneuvering speed: where a full pull stalls the wing at the 3.0 g limit load |
| **Vmo** | Maximum operating speed: 300 KIAS below 8,000 ft, 340 KIAS to 20,000 ft, 330 KIAS above 23,000 ft |
| **VNAV** | Vertical navigation: flies the plan's altitude constraints within the preselected altitude, climbs by speed, and descends from top of descent |
| **VOR** | VHF omnidirectional range, a navaid |
| **VR** | Rotation speed. Rotate to about +9°; the tail strikes at 11° |
| **VREF** | Reference landing speed, flaps 40, from AFM Fig 5-66. 139 kt at the 19,500 lb maximum landing weight |
| **VS** | Vertical speed mode |
| **Vs1** | Stall speed in a given configuration |
| **VSI** | Vertical speed indicator |
| **W/δ** | Weight divided by the pressure ratio. The buffet chart is drawn in it, so one lift coefficient carries to any altitude |
| **WAAS** | The satellite augmentation that LPV approaches need. Not fitted here |
| **WebGL2** | The browser graphics API the renderer is written for. It also needs `EXT_color_buffer_float` |
| **WebHID** | The browser API for raw HID devices. Used for force-feedback sticks, in Chrome and Edge only |
| **YD** | Yaw damper |

## ARINC 424 leg types

The path terminators `js/fms.js` flies. The first letter says what the leg follows; the second says where it ends.

| Code | Leg |
|---|---|
| **IF** | Initial fix: where a procedure starts |
| **TF** | Track to a fix, from the previous fix |
| **CF** | Course to a fix |
| **DF** | Direct to a fix |
| **CA**, **FA**, **VA** | Course, course from a fix, or heading to an altitude |
| **CD**, **FD**, **VD** | Course, course from a fix, or heading to a DME distance |
| **CI**, **VI** | Course or heading to intercept the next leg |
| **FM**, **VM** | Course from a fix or heading until manually terminated |
| **RF** | Radius-to-fix arc |
| **AF** | DME arc |
| **HF**, **HA**, **HM** | Holds: one circuit, to an altitude, or until manually terminated. Entered direct, teardrop or parallel |

Altitude constraints on legs use `@` (at), `+` (at or above), `-` (at or below) and `B` (between), plus the
glideslope and step-down codes in the CIFP. See [FMS and navigation](fms.md).
