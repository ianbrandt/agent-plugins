# Eval cases

Each case is a small invented project with a change that has defects planted on purpose. A reviewer
of the change should report the findings listed in the case. Nothing here comes from a real project.

- `case.json`: the commit `message` of the change, and `findings`.
- `base/`: the project before the change.
- `head/`: each file the change adds or rewrites, in full.
- A finding has `path`, `line`, `severity` (`high`, `medium`, or `low`), and `summary`. `line` is in
  the file as of `head/`, or in `base/` for a file the change left alone, and is `null` for a
  file-level finding. A finding on a line the change left alone is still a defect to report.
- `defect`: optional label. Findings with the same label are one defect that appears at several
  lines; a finding without one is its own defect.

`npm run eval:review -- check` builds each case and checks its findings against the files, without
running a review.
