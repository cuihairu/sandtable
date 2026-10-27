function daily_analysis(out_dir)
% DAILY_ANALYSIS  Sandtable real-data analysis template (base MATLAB only).
%   Reads the artifacts written by `sandtable simulate --out <dir>` (days.csv +
%   report.json) and, when present, `sandtable compare --out <dir>`
%   (comparison.json). Prints a KPI summary and an A/B verdict, then plots the
%   day-granularity curves on separate axes (different units never share one).
%
%   The template is a self-service starting point, not a library: it uses only
%   base MATLAB (readtable / jsondecode / plot), so no Toolbox license and no
%   MATLAB Engine are required for the default analysis surface. The MATLAB
%   Engine evaluation (calling the kernel from MATLAB, task state / log /
%   output-dir / result reclamation) stays gated on a concrete local-call need
%   per docs/guide/09; the core simulation and the default charts never depend
%   on a commercial license.
%
%   Usage:
%       daily_analysis('out/sim/')    % a simulate output dir
%       daily_analysis('out/cmp/')    % a compare output dir (comparison.json)
%       daily_analysis('out/')        % both artifacts side by side
%
%   Labels and console output stay English on purpose: no CJK glyph dependency
%   for MATLAB figure fonts (same discipline as the Python template PNGs).

if nargin < 1 || isempty(out_dir)
    out_dir = '.';
end

days_path = fullfile(out_dir, 'days.csv');
report_path = fullfile(out_dir, 'report.json');
compare_path = fullfile(out_dir, 'comparison.json');

fprintf('Sandtable analysis of: %s\n', out_dir);

% --- KPI summary from report.json -----------------------------------------
report = read_json_if(report_path);
if isempty(report)
    fprintf('  (no report.json; KPI summary skipped)\n');
else
    meta = report.meta;
    fprintf('  model_version %s  schema_version %s\n', ...
        char(meta.model_version), char(meta.schema_version));
    results = report.results;
    r = results(1);
    fprintf('  replicate %d  players %d  days %d  seed %d\n', ...
        r.replicate, r.players, r.days, r.seed);
    if ~isempty(r.retention_d7)
        fprintf('  retention_d7 %.4f   win_rate %.4f   churn_total %d\n', ...
            r.retention_d7, r.win_rate, r.churn_total);
        fprintf('  inflation_last %.4f   sink_ratio_mean %.4f\n', ...
            r.inflation_last, r.sink_ratio_mean);
    end
end

% --- A/B verdict from comparison.json -------------------------------------
cmp = read_json_if(compare_path);
if isempty(cmp)
    fprintf('  (no comparison.json; A/B verdict skipped)\n');
else
    c = cmp.comparison;
    fprintf('  A/B metric %s   attack_a %g  attack_b %g\n', ...
        char(c.metric), cmp.attack_a, cmp.attack_b);
    fprintf('    arm_a mean %.6f  CI95 [%.6f, %.6f]  n %d\n', ...
        c.arm_a.mean, c.arm_a.ci95_lo, c.arm_a.ci95_hi, c.arm_a.n);
    fprintf('    arm_b mean %.6f  CI95 [%.6f, %.6f]  n %d\n', ...
        c.arm_b.mean, c.arm_b.ci95_lo, c.arm_b.ci95_hi, c.arm_b.n);
    fprintf('    diff  mean %.6f  CI95 [%.6f, %.6f]  effect_size d %.3f\n', ...
        c.diff_mean, c.diff_ci95_lo, c.diff_ci95_hi, c.effect_size_d);
    fprintf('    verdict: %s\n', verdict_text(c.verdict));
end

% --- Day-granularity curves from days.csv ----------------------------------
if exist(days_path, 'file') ~= 2
    fprintf('  (no days.csv; curves skipped)\n');
    return;
end
days = readtable(days_path);
n = height(days);
fprintf('  days.csv rows %d\n', n);
if n == 0
    return;
end

[has_day, day] = named_column(days, 'day');
if ~has_day
    fprintf('  days.csv has no `day` column; curves skipped\n');
    return;
end

figure('Color', 'w', 'Name', sprintf('sandtable daily (%s)', out_dir));
panels = {'win_rate', 'win rate'; 'mean_power', 'mean power'; 'churn_rate', 'churn rate'};
for p = 1:size(panels, 1)
    [ok, values] = named_column(days, panels{p, 1});
    if ~ok
        continue;
    end
    subplot(size(panels, 1), 1, p);
    plot(day, values, '-o', 'MarkerSize', 4, 'LineWidth', 1);
    grid on;
    ylabel(panels{p, 2});
    xlabel('day');
    title(panels{p, 1});
    xlim([min(day), max(day)]);
end
end

% ---------------------------------------------------------------------------
function out = read_json_if(path)
out = [];
if exist(path, 'file') == 2
    out = jsondecode(fileread(path));
end
end

function [ok, data] = named_column(t, name)
names = t.Properties.VariableNames;
idx = find(strcmp(names, name), 1);
ok = ~isempty(idx);
if ok
    data = t.(name);
else
    data = [];
end
end

function s = verdict_text(v)
switch char(v)
    case 'BHigher'
        s = 'B higher than A (paired CI excludes 0)';
    case 'AHigher'
        s = 'A higher than B (paired CI excludes 0)';
    case 'NoDifference'
        s = 'no significant difference (paired CI contains 0)';
    otherwise
        s = char(v);
end
end
