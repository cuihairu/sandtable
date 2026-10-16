# 22 · Web

[English](22-web.en.md) | [中文](22-web.md)

The Phase 6 deliverable (document [Roadmap](./18-roadmap.en)): **"Try in your browser"** — open the page, change the configuration, run a small-to-medium simulation locally, charts come out directly, zero install, data never leaves the browser.

## Form factor

`apps/web`: a Vite + React + TS frontend consuming the `sandtable-wasm` binding artifacts (a `file:` dependency, not via the npm registry). Zero charting libraries — per-day curves are hand-drawn SVG in the frontend (the same visual discipline as the CLI `report` subcommand: no CDN, no external resources, no JS charting runtime).

Page capabilities (current increment):

- Preset configurations (minimal RPG / Pokémon case) load in one click, or import a local `.yaml` configuration file and edit it directly in the editor;
- `replicates` 1–8, running `run_simulation` locally;
- KPI cards (D3/D7 retention, daily win rate, total churn rate, gold per player, power per player) and `config_hash`;
- Per-day curves (daily active / daily win rate / gold stock / level-up count);
- Cohort table (level, gold, power, churn for casual / core / whale);
- **SQL query panel (DuckDB-Wasm)**: the simulation artifact is loaded into the in-memory table `days`, and arbitrary SQL runs locally (result table + one-click line chart of the per-day numeric columns). Zero external requests — worker and wasm are both bundled locally through vite `?url`, not via a CDN; the mvp single-threaded build is loaded on demand (39 MB of assets, downloaded only when the query is opened);
- **Result export**: `days.csv` (replicate 1, byte-for-byte identical to what the CLI's `simulate --out` writes to disk), `report.json` (structurally isomorphic, with `results` identical value by value), and `days.parquet` (the same per-day data written to Parquet through DuckDB `COPY ... (FORMAT PARQUET)`, zero new dependencies), all downloadable in one click — drop them into one directory and `sandtable report` / `sandtable query` can continue the analysis ([data output](./09-data-output.en) contract);
- **Project packing and typed-path entry (2026-10-13)**: the toolbar's "Pack project (.sandtable)" packs the two editors' contents + the current results into a `.sandtable` (fflate, manifest v1, entries sorted by path, per-entry sha256 via WebCrypto, archive timestamp fixed at 1980-01-01, the same rules as the CLI's `project pack`), read directly by `sandtable project check` / `unpack`; besides the native dialog (multi-select), the "local result file analysis" panel also has a typed-path entry (single append with de-duplication, views still registered by file stem) — the equivalent route for when the native dialog cannot be automated headlessly, with functionality identical to the duckdb-rs query. Desktop downloads are wired through the shell's `on_download` into `~/Downloads` (same names automatically get a (n) suffix, see [Roadmap Phase 7](./18-roadmap.en));
- **Parameter sweep (grid / Random + recommendation band + joint feasible region)**: the experiment file (three sections: scenario + model + sweep, [document chapter 12](./12-parameter-sweep.en)) is swept locally — through YAML editing or the preset selector (single-axis grid / single-axis random / two-axis grid), driven candidate by candidate by JS (candidate parallelism is unavailable under single-threading; the main thread yields between candidates, so progress can be rendered); it produces a candidates × metrics table (constraint verdicts PASS / BORDERLINE / FAIL, failing candidates annotated and never silently dropped), single-axis charts (grid line / Random scatter, CI95 required, verdicts color-coded, recommendation band and baseline markers), the two-axis joint feasible region matrix (per-target three-color verdicts, sparse Random cells left empty), the OAT sensitivity matrix and the recommendation block — the same source as the CLI's `sweep` / `recommend` (core pure functions); budget gates: candidates × replicates ≤ 200, players × days ≤ 400,000, beyond which users are steered to the CLI.

## Binding discipline

[`sandtable-wasm`](https://github.com/cuihairu/sandtable/tree/main/crates/sandtable-wasm) is a **thin binding**:

- It forwards core only (load → validate → run) and **carries no simulation logic**; the real logic lives in native pure functions (`*_native`), which cargo test covers directly;
- The wasm entry points return **JSON strings** and the frontend calls `JSON.parse` — it does not go through serde-wasm-bindgen's JsValue protocol (measured silent incompatibility with newer wasm-bindgen: to_value produces an empty object; a string is the most stable channel across the wasm ABI);
- `run_simulation` output carries `days_csv` (replicate 1, straight out of `core::export::day_csv`) — the CSV is rendered by Rust, so browser downloads and CLI on-disk writes are **byte-for-byte identical** (locked down by `web_parity`); floats are never reassembled on the JS side;
- The three sweep bindings (`sweep_plan / sweep_candidate / sweep_recommend`) are pure forwarding as well; candidate parallelism (rayon) is unavailable under single-threading, so **JS drives them candidate by candidate**, yielding the main thread between candidates — `replicates` is given uniformly by the plan; candidate / recommend do not each interpret it; recommendation covers a single parameter axis only (an MVP red line, refused the same way as [document chapter 15](./15-recommendation.en));
- `meta` carries only `schema_version / model_version`; `generated_at_unix / git_sha` are environment fields, injected by the frontend build (`VITE_GIT_SHA`, injected during the CI build; falling back to `unknown` when not injected, the same as the CLI without `SANDTABLE_GIT_SHA`); the binding layer does not fabricate them;
- The ceiling on replicates is 64 (the Web form targets small-to-medium simulations: the 4GB WASM memory cap, single-threaded, [data output](./09-data-output.en)); larger experiments are steered to the CLI / desktop.

## Equivalence acceptance

The roadmap's Phase 6 acceptance criterion: **the browser and the CLI, with the same configuration and the same seed, produce statistically equivalent results**. It is locked down by `crates/sandtable-cli/tests/web_parity.rs` — with the same configuration and the same seed, the report.json from the CLI's `simulate` and the results from the binding's `run_simulation_native` are **identical value by value** (not merely close in statistics; `serde_json` has `float_roundtrip` enabled, so an f64 written to disk and read back is bit-identical).

Scripting-layer Phase 1 (2026-10-11) closed the third edge: `crates/sandtable-python/tests/test_parity.py` locks py↔CLI with the same paradigm (simulate / sweep / recommend identical value by value, `days_csv` byte-for-byte identical to the CLI's `days.csv`) — the core is the single source of truth, and the pairwise equivalence loop over three independent thin forwardings (web_parity + py_parity + the desktop equivalence test) is complete.

## CI gates

All three jobs in `.github/workflows/ci.yml` cover the wasm surface:

- `test` job: the WASM compile gate (core, wasm32) + the WASM binding build gate (wasm-pack `--dev` produces pkg);
- `web` job: wasm-pack `--release` produces pkg → `npm ci` → `npm run build` (type check + bundling, asserting the artifacts contain .wasm) → **`node --test` frontend guards** (`tests/columns.test.mjs` column normalization including BigInt, `tests/presets.test.mjs` presets passing through the real wasm kernel, `tests/project.test.mjs` pack/unpack loop + path discipline + packed artifact passing through the real kernel; the latter two require pkg-node);
- `desktop-smoke` job (2026-10-13): wasm-pack `--target web --dev` produces pkg (the desktop shell inlines `web/dist` at compile time via custom-protocol, and tsc must resolve the file:pkg types as well) → frontend build → Xvfb brings the shell up headless and takes a screenshot for adjudication (startup-chain gate, recipe in `scripts/desktop_smoke.sh`).

The standalone workflow `.github/workflows/desktop-package.yml` (2026-10-13, manually triggered via `workflow_dispatch`): same wasm pkg + frontend artifact preconditions → `tauri-action` packages installable artifacts for three platforms (Windows msi+nsis / macOS dmg+app / Linux deb) and uploads them as artifacts — **no tags, no Release created**; unaccepted binaries never reach the Releases page (the version number is only ever supplied manually by the user). The frontend artifact is likewise produced first (custom-protocol inlining), so this pipeline incidentally also covers wasm type resolution and frontend bundling.

## Running locally

See [apps/web/README](https://github.com/cuihairu/sandtable/tree/main/apps/web): first `wasm-pack build crates/sandtable-wasm --target web`, then `npm install && npm run dev`.

To build the desktop installers locally: `cd apps/desktop/src-tauri && tauri build --features custom-protocol` (you need `apps/web/dist` ready first, see above); when verifying only the compilation chain, add `--bundles deb` to skip the AppImage download. For regenerating icons see [src-tauri/assets/README](https://github.com/cuihairu/sandtable/tree/main/apps/desktop/src-tauri/assets).

## Follow-ups

- ~~Change the query panel to load the CSV / Parquet files carried along with the results~~ **CSV and project files have landed (2026-10-09, a47ad10 + 9edca3f)**: the query panel can load a `.sandtable` (unpacked locally with fflate, validated by the same rules as the CLI's `project check` — manifest v1, path discipline, per-entry sha256 via WebCrypto, archive file set strictly equal to the manifest) or loose CSV files, with the artifact registered as a DuckDB in-memory table for direct SQL; the "Import configuration file" button at the top accepts `.sandtable`, taking the first entry in path order from scenario / experiment and wiring it into the simulation and sweep editors (opening the project file reproduces the experiment, closing the loop with document chapter 09). **All remaining items have landed (2026-10-10)**: a multi-configuration selector for projects — when a `.sandtable` holds multiple scenarios / experiments, the toolbar shows a dropdown to switch (default = the first entry in path order; a single entry takes no slot); direct Parquet reading — the query panel accepts loose `.parquet` files and Parquet artifacts inside a project, with duckdb-wasm `read_parquet` loading the table (the read function picks by extension, CSV still goes through `read_csv_auto` unchanged). Per-day simulation data remains queryable at the same time (the `days` table).
- ~~Frontend-ize the multi-axis joint feasible region and Random search for sweeps~~ **Done (2026-10-09, 1952308 + 9b75565)**: the Random preset + scatter plot (sampled points not connected, axis tick labels thinned out); the two-axis joint feasible region matrix (SweepMatrix, per-target three-color verdicts, sparse Random cells honestly left empty, a downgrade prompt when a single axis has too many values); the single-axis recommendation band red line unchanged, and with ≥3 axes still only a candidate table.
