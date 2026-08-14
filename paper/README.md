# The SoftwareX manuscript

```bash
make        # build softwarex.pdf
make data   # regenerate every figure dataset from the software itself
make clean
```

`make` needs only a TeX distribution. `make data` needs Node, and is deliberately
**not** a prerequisite of the PDF: the datasets are committed, so the paper
builds on a machine without Node, and regenerating them is a deliberate act.

## Where the numbers come from

Nothing in this paper is transcribed by hand. Every figure and the results
table read `.dat` files written by the two generators, which import the very
modules the application runs:

| Generator | Writes | Used by |
|---|---|---|
| `figures/makedata.js` | the reference ring, the family of thrust lines, the admissible bands, the minimum-thickness table | Figs. 2–3, Table 4 |
| `figures/makeexample.js` | one stored example, recomputed: blocks, thrust line, Hooke cable, force polygon | Fig. 1 |

`makeexample.js` also writes `data/<name>_meta.tex`, which carries the
agreement between the recomputed solution and the one MATLAB stored. The
caption of Fig. 1 quotes it, so the figure states its own fidelity and cannot
drift from it.

Two traps are recorded in the generators, both found the hard way:

- **No `#` in a `.dat` header.** pgfplots reads these files with TeX, for which
  `#` is the macro parameter character; the build dies with *Illegal parameter
  number* pointing at the `\addplot`, not at the data.
- **elsarticle leaves no space under a table caption**, so booktabs draws
  `\toprule` through the caption's last line. Reproduced in a document
  containing nothing but `elsarticle` and `booktabs`, so it is the class, not
  this paper; `\setlength{\belowcaptionskip}{6pt}` in the preamble is the fix.

## Before submitting — decisions that are yours

1. **Tag the release.** `package.json` and the metadata table now both say
   **1.0.0**, but no git tag exists yet. Create `v1.0.0` so C1 refers to
   something.
2. **DOIs in `refs.bib`** are deliberately absent rather than guessed. Add them
   from the publishers' records if the journal asks.
3. **Length.** Six pages, which is the SoftwareX limit — there is no slack. If
   anything is added, something has to go; the most compressible section is
   2.2.

Settled:

- **Authorship** — G. Castellazzi alone.
- **C3** — the running HTML application is itself the capsule; it is served as
  static files and needs no environment to reproduce. No Zenodo archive is
  claimed.
- **C8** — `docs/index.html` has been rewritten for the browser version and
  now documents the free ends, the scale and unit conventions, admissibility
  and the save format, with the MATLAB application kept as a clearly-marked
  frozen predecessor.

## What the paper claims, and where it is checked

| Claim | Checked by |
|---|---|
| 15 stored examples reproduced; worst relative error $8.5\times10^{-16}$ (force polygon), $3.9\times10^{-15}$ (thrust line) | `tests/core.test.js`, and re-measured across every example file |
| Poleni example agrees to $8.0\times10^{-16}$ | `figures/makeexample.js`, quoted into the caption |
| 6 examples internally inconsistent, and detected | `consistency()` in `core/model.js` |
| pinned ends: least $t/r_i = 0.198$; free ends: $0.115$ | `tests/admissibility.test.js`, and `minthick.dat` |
| the limit line runs through the extrados at both springings | `tests/admissibility.test.js` |
| 72 tests | `npm test` |
| 2831 lines across 10 modules | `wc -l docs/app/js/**/*.js` |
