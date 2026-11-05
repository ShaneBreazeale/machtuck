# Contributing

Issues and pull requests are welcome, especially better sources: photos of N722BD for the livery, or published
Learjet 60 data that can replace an estimate. Run the test suite before opening a pull request, and keep every number
traceable to a source or marked as an estimate.

That is the README's whole contributing guide. The rest of this page spells out the principles behind it, the
workflow, the code style you'll find in the repo, and how to edit this wiki.

## Principles

### Every number has a source or is marked as an estimate

A constant in the model either names where it came from or says that it is an estimate. The file headers and the
comments next to each value carry the citations: the AFM (FM-123) figure and page, SAE 932534, EASA TCDS IM.A.212,
AIAA 90-2520, the FlightSafety PTM chapter, a Part 25 paragraph, a textbook equation. In `js/aero.js`, constants marked
"calibrated" were set against the single AFM point named next to them. The design dive speed of 377 KIAS / M 0.89 is
an example of an estimate that says so, because it isn't published anywhere.

If you change a number, change its comment too. If you replace an estimate with published data, cite the data. The
[Validation](validation.md) page and the checks in [Testing](testing.md) show how the model is held to its sources.

### Navigation is generic and data-driven

Procedures, routes, approaches and minimums come from the data: the FAA CIFP in `data/nav/` and the plates in
`data/plates/`. `js/fms.js` flies any ARINC 424 leg sequence, `js/navdb.js` assembles procedures from the data, and
`js/route.js` builds the whole plan. None of them knows about a particular airport or route.

Never hand-code a procedure, a fix, an altitude or a special case for one airport or one scenario. If something
doesn't fly right at one airport, fix the engine so it flies right everywhere, and add a test that uses the real data.

### Respect for the accident

- The cause of the N722BD accident is undetermined. Every upset scenario is a **hypothesis, not a finding**, and the
  text in the game, the README and this wiki should say so wherever it matters.
- The crew's final transmissions stay out of the game. Don't add them to the timeline, the log, the callouts or the
  docs.
- The timeline comes from public reporting and is provisional. Don't present it as more certain than its sources.

### Real data first

The storm comes from NEXRAD, GOES-19 and GLM, the procedures from the CIFP, the minimums from the plates, and the
performance from the AFM. Prefer real data with a fetch script in `tools/` over a hand-made approximation. See
[Data pipeline](data-pipeline.md).

### Difficulty never changes the physics

The trainer mode only changes the autopilot. `test/aero_validate.mjs` requires identical trajectories in both modes
for the same seed and inputs. Keep it that way.

## Workflow

1. Fork the repository, or create a branch if you have access. Don't commit to `main` directly.
2. Make the change, and try it in a browser with a local static server (below).
3. Run the test suite with Node 22 (below). If you touched the renderer, also check the frame rate with
   `node tools/bench.mjs 2560x1320 8080`. See [Testing](testing.md).
4. Open a pull request against `main`. Say what you changed, why, and what sources back any new numbers.
5. After the merge, GitHub Pages serves `main` as it is. There is no build or deploy step, so what is on `main` is
   what players get at https://shanebreazeale.github.io/machtuck/.

To try a change, serve the repository root and open http://localhost:8080 (the sim) or
http://localhost:8080/wiki/ (this wiki):

```bash
python3 -m http.server 8080
```

To run the tests:

```bash
for t in test/*.mjs; do node "$t" || echo "FAILED: $t"; done
```

If you regenerate data, commit the script change and the regenerated files together, and note the source cycle or
date in the pull request.

## Code style

The code has a consistent house style. Match it in new code:

- **Plain ES modules, no dependencies.** Each file in `js/` imports what it needs with relative paths. No bundler, no
  npm packages, no transpiling. Anything that runs in Node (the physics, guidance, navigation and hardware logic)
  must not touch the DOM; inject browser objects instead, the way `js/hardware.js` takes a `getPads` function and a
  localStorage-like `store`, and `js/ffb.js` takes `hid` and `store`.
- **A header comment on every file.** It says what the module does, the frame and units it works in, and where its
  numbers come from.
- **Comments cite sources.** For example `// Fig 5-42 Uncorrected takeoff speeds, flaps 8 ...` in `js/afm.js`, or a
  reference to `AC 25.1329-1C 65c(2)` next to the mode annunciation it implements.
- **Dense code.** Short names in the math, several statements on a line where they belong together, and comments that
  explain why rather than what.
- **SI inside, aviation units at the edges.** Metres, seconds, radians and NED internally; feet, knots and degrees
  only for display, data input and tests. Use `FT`, `KT` and `DEG` from `js/atmo.js` and `js/util.js`. See
  [Architecture](architecture.md#units-and-frames).
- **British spelling in prose.** The README and comments use tyres, centreline, metres and licence.
- **Python tools are self-describing.** Each script's docstring gives its source URL, licence, method, output format
  and usage line, and the defaults write to the right place in `data/`.

## Documentation

The wiki lives in `wiki/`. It is static Markdown rendered in the browser by `wiki/wiki.js`, with no build step, like
the sim.

### Pages and order

- Each page is a file in `wiki/pages/<slug>.md`. The slug is the file name without `.md`.
- The sidebar order, the section names and the page titles are in `wiki/pages.json`. Add a new page there, or it
  won't appear in the sidebar, the previous/next links or the search.
- Start each page with one H1 that matches its title in `pages.json`, then use H2 and H3 sections. The "On this
  page" box lists the H2 and H3 headings once a page has more than two.
- Every page gets an "Edit this page on GitHub" link automatically.

### Links

Link to another page by its file name, so the same link works on GitHub and in the wiki:

```markdown
See [Testing](testing.md) and [the benchmark](testing.md#frame-rate-benchmark).
```

A heading's id is its text in lower case, with punctuation removed and spaces turned into hyphens. "Frame-rate
benchmark" becomes `frame-rate-benchmark`, and "Units and frames" becomes `units-and-frames`. A link to `#heading-id`
alone stays on the current page. Paths to files in the repository are relative to `wiki/`, for example
`../docs/img/screenshot.jpg` for an image.

### Supported Markdown

`wiki/wiki.js` renders a deliberate subset:

- Headings `#` to `######`, paragraphs, horizontal rules.
- `**bold**`, `*italic*`, `~~strikethrough~~`, inline code in single backticks, links, images and bare `https://`
  URLs.
- Bulleted and numbered lists, nested with a 2-space indent; `- [ ]` task items.
- Tables with a header row and a separator row (`:---:` and `---:` align columns). Write a literal `|` in a cell as
  `\|`.
- Fenced code blocks with an optional language name.
- Blockquotes, and four callouts when the quote starts with a bold label:

```markdown
> **Note:** Background the reader may want.

> **Tip:** A shortcut or a better way.

> **Important:** Something the reader must not miss.

> **Warning:** Something that can go wrong.
```

Separate callouts with a blank line: consecutive `>` lines join into one blockquote. Raw HTML is not supported: it is escaped and shows up as text.

### Style

Write plain, direct English in short paragraphs. Say what the sim does and where the number comes from, and link to
the page that explains it rather than repeating it. Keep the [principles](#principles) in the docs too: hypotheses
are hypotheses, and the crew's final transmissions stay out.

### Preview locally

Serve the repository root with any static server and open `/wiki/`:

```bash
python3 -m http.server 8080
# then open http://localhost:8080/wiki/
```

Pages are fetched with `no-cache`, so a reload shows your latest edit. A page listed in `pages.json` without a file
shows "Not written yet".
