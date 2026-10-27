---
title: 10 · CLI
---


# CLI

In phase 1 the CLI is the first-priority UI.

## Subcommands

| Command | Purpose | Phase |
| --- | --- | --- |
| `sandtable simulate` | Run one simulation | **MVP** |
| `sandtable compare` | Compare two / more run results | **MVP** |
| `sandtable validate` | Validate configuration (registry, schema, formulas) | **MVP** |
| `sandtable init` | Generate a sample configuration skeleton | MVP, incidental |
| `sandtable scaffold` | Generate a new scenario / experiment skeleton (scenario + params + sweep draft + README, self-checked) | 2026-10 |
| `sandtable sweep` | Parameter sweep experiments | Phase 3 |
| `sandtable query` | After-the-fact SQL exploration of result datasets (DuckDB) | Phase 3 |
| `sandtable recommend` | Generate the sensitivity matrix and recommendation interval from sweep artifacts | Phase 4 |
| `sandtable params` | Numeric parameter table export / import (flat CSV) | Phase 5 |
| `sandtable report` | Generate an HTML report | Phase 5 |
| `sandtable project` | Project packaging pack / unpack / check (`.sandtable`) | 2026-10 |
| `sandtable workbook` | Multi-sheet `.xlsx` from result artifacts (read-only delivery) | Excel workflow |
| `sandtable optimize` | Automated optimization experiments (evolutionary / Pareto multi-objective) | Phase 8 |
| `sandtable surrogate` | Random-forest surrogate model train / predict / importance | Phase 8 |
| `sandtable disttest` | Distribution tests (uniform / weighted / normal χ²; test bench, not in the simulation path) | Random functions (chapter 24) |

The scope of optimization and the surrogate is covered in the automated-optimization section of [Parameter sweep](./12-parameter-sweep.md) and the surrogate section of [Balance recommendation](./15-recommendation.md); the capability list, phasing, and acceptance of the distribution tests are in [Random functions and probability systems](./24-random-functions.md).

## Usage

```bash
sandtable simulate scenario.yaml
sandtable scaffold demo --out .
sandtable sweep experiment.yaml
sandtable compare --attack-a 100 --attack-b 105 --replicates 12
sandtable query sweep/summary.csv --sql "SELECT * FROM summary WHERE t1_win_rate = 'PASS'"
sandtable recommend experiment.yaml sweep-out/
sandtable params export scenario.yaml --out params.csv
sandtable project pack myproj --out myproj.sandtable
sandtable workbook experiment-out/ --out workflow.xlsx
sandtable report experiment/
sandtable optimize opt-exp.yaml --out opt-out/
sandtable surrogate train sweep-out/ --metric retention_d7
sandtable disttest normal --samples 100000 --buckets 20
```

### scaffold (new scenario skeleton)

```bash
sandtable scaffold demo --out .    # creates ./demo/
```

Generates a four-piece skeleton under `<out>/<name>/`: `scenario.yaml` (minimal runnable, `model:` guide in comments), `params.csv` (baseline exported from the same scenario), `experiment.yaml` (single-axis sweep draft), and `README.md`. Generation is self-checked: the scenario template must pass core load + validate, and the params table is produced by the real `params export` path, so a broken template fails at generation time instead of shipping a skeleton that cannot run. The name whitelist is `^[A-Za-z][A-Za-z0-9_-]*$` (length ≤ 64); an existing target directory is never overwritten. Templates live in `crates/sandtable-cli/src/scaffold/templates/` as the single source of truth (the web new-scenario wizard consumes the same set via the wasm binding later).

### query (Phase 3, feature `duckdb`)

`sandtable query` is the shell over the [analysis layer](./09-data-output.md): it runs SQL against result datasets already on disk (CSV / Parquet), and the simulation path never goes through the database. Each input file is registered as a DuckDB view named after the file's basename, which SQL references directly:

```bash
# CSV: failed candidates in the sweep summary table
sandtable query sweep-out/summary.csv \
  --sql "SELECT candidate, error FROM summary WHERE status = 'config_error'"

# Parquet: day-7 quantile power (dataset produced by the parquet feature)
sandtable query out/day_stats.parquet \
  --sql "SELECT day, win_rate, sink_ratio FROM day_stats WHERE day <= 7 ORDER BY day"
```

- Multiple input files can be registered at once; the view name = the file's basename (e.g. `summary.csv` → `summary`);
- Results go to stdout as a table by default; with `--out result.csv` they land on disk as CSV;
- DuckDB ships behind the `duckdb` feature (bundled static build) and is absent from the default build — the analysis dependency is heavy and is not carried on the minimal build.

### recommend (Phase 4)

`sandtable recommend` reads the `sweep` artifacts (sweep.json) and the experiment file (the baseline configuration), recomputes the [OAT elasticity](./14-sensitivity.md), and produces a [single-axis recommendation interval](./15-recommendation.md) — sweep data reused, zero extra simulation:

```bash
sandtable recommend experiment.yaml sweep-out/            # a directory or a sweep.json path both work
sandtable recommend experiment.yaml sweep-out/ --out rec.json
```

- The MVP supports only a **single parameter axis** (the chapter 15 red line): if the sweep defines multiple parameters it errors, exit code 2;
- stdout first prints the sensitivity matrix (elasticity E and intervals per parameter × metric; intervals spanning zero are marked "not significant", and non-computable ones are honestly marked with the reason), then the recommendation block (Current / Recommended / Reason / Confidence; the shape is in chapter 15);
- When a recommendation-interval endpoint comes from linear interpolation between grid points, the reason says so (chapter 15: a continuous interval cannot be read straight off the grid);
- Confidence is a criterion, not an adjective: High / Medium / Low; the criteria are in chapter 15;
- `--out rec.json` writes the sensitivity matrix and the recommendation to disk for the report layer (Phase 5) to reuse;
- The spec and results in sweep.json are deserialized as-is, with metric names in snake_case (e.g. `win_rate`).

### params (Phase 5)

A two-way flat-CSV channel between the numeric parameter table and YAML (evaluation conclusion in [Data output](./09-data-output.md)): designers maintain the numbers in Excel, save as CSV, and re-import:

```bash
# Export all numeric parameters as a (path,value) template
sandtable params export scenario.yaml --out params.csv

# Re-import after editing: per-line overrides onto the baseline configuration with validation,
# errors reported per line (exit code 2); the baseline scenario is the optional
# second positional argument
sandtable params import params.csv base.yaml --out merged.yaml
sandtable simulate merged.yaml
```

- Table format: a `path,value` header, one numeric parameter per row; blank lines and lines starting with `#` are skipped;
- Coverage = every numeric parameter in the registry (integers / floats / cohort weights); formula slots and durations (`30d`) do not go through the parameter table — edit the YAML directly when customization is needed;
- Import takes the baseline scenario as the optional second positional argument (the default configuration when omitted); unknown paths get edit-distance suggestions; invalid / out-of-range values and duplicate paths are flagged line by line, never silently skipped;
- On success it prints `config_hash`; `--out merged.yaml` produces a scenario file ready to simulate (containing the scenario section's population / duration / seed / population_mix and the full numeric parameters of the model section).

### project (project packaging)

Packs scenario / experiment definitions (optionally artifacts) into a single `.sandtable` archive for exchange between CLI / Web / Desktop; the manifest v1 contract and validation rules are in [Project packaging](./09-data-output.md):

```bash
sandtable project pack myproj --out myproj.sandtable    # directory → archive
sandtable project unpack myproj.sandtable --out restored # validate, then extract (target directory must be empty)
sandtable project check myproj.sandtable                 # validate only, nothing written
```

- Import validates everything up front: manifest structure, path discipline, per-entry sha256, the archive's file set strictly equal to the manifest, and each scenario / experiment loaded and validated — bad entries are all reported before failing (exit code 2);
- Packing determinism: packing the same directory twice is byte-identical (entries sorted by path, fixed timestamps);
- Project adds no simulation semantics — what comes out of an unpack is just ordinary configuration files, directly runnable by `simulate` / `sweep`.

### report (Phase 5)

Renders result directories (one or more) into a single-file HTML report — KPI, A/B comparison, sweep summaries and charts, sensitivity and recommendation; the source-file mapping table from [Data output](./09-data-output.md) lives there:

```bash
sandtable report sim-out/ sweep-out/ rec.json --out report.html
sandtable report experiment/                 # writes ./report.html by default
```

- Reads only artifacts already on disk (`report.json` / `comparison.json` / `sweep.json` / `rec.json` / `days.csv`) and renders whatever it finds;
- The output is self-contained: inline CSS + inline SVG, no CDN, no JS, opens offline;
- Not a single source file found → exit code 2.

### workbook (Excel / JMP / Origin delivery)

Reads the artifacts already on disk in a result directory and writes one sheet per known artifact plus `manifest` (self-description) and `metric_dictionary` (kernel `kpi_dict`) — the data-delivery side of the [Data output](./09-data-output.md) contract:

```bash
sandtable workbook experiment-out/                    # writes experiment-out/sandbox.xlsx
sandtable workbook experiment-out/ --out workflow.xlsx
```

- Known artifacts: `params.csv` / `candidates.csv` / `summary.csv` / `comparison.json` / `days.csv`, plus `cohort.parquet` when built with the `parquet` feature; missing ones are recorded in `manifest` as `absent` and **get no sheet** (absent ≠ empty table);
- Sheet contract: one sheet = one table, single header row on row 1, no merged cells, no trailing blank rows; numeric fields become real numeric cells (no "text-form number" pivot warnings);
- Field-mapping reuse: field names and order come straight from the artifacts — the workbook recomputes nothing and renames no column; `metric_dictionary` shares the kernel `kpi_dict` column names with the CSV and `sweep.json` constraint names;
- Deterministic: fixed archive timestamps (1980-01-01), same input → byte-identical output;
- Exit code `2` when the directory holds no known artifact or is not a directory;
- It is **read-only delivery** — the two-way CSV entrance (`params export / import`) remains the only configuration path; no multi-sheet → config-tree mapping.

The zero-dependency reader is `scripts/templates/workbook_sheets.py` (`list` / `dump <sheet>` / `check`), standard library only.

## Output conventions

- **stdout**: a human-readable summary (run time, key metrics, constraint PASS / FAIL), aimed at the terminal;
- **Files**: complete results land on disk per the [output directory convention](./09-data-output.md); stdout never carries the full data;
- **Exit codes**: `0` success; `1` simulation or experiment failure; `2` configuration / parameter error (so CI can tell them apart);

## Determinism requirements

`compare` output must be stable for identical inputs: deterministic ordering (candidates sorted by experiment identity, not directory traversal order) and fixed float formatting (no scientific-notation jitter). Rerunning `simulate` with the same seed produces identical output content except for the environment fields in `meta.json` ([Data output](./09-data-output.md)).

## Error message style

Configuration errors must name the **specific path and reason** (e.g. `warrior.atk: 未知参数,你是否想写 warrior.attack?注册表中相近路径: warrior.attack`); error messages face configuration authors, not kernel developers.
