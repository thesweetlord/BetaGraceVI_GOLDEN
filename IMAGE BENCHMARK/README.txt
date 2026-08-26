# BetaGrace High-Density Image Generation Benchmark
**Constraint-Locking Evaluation Suite**  
Version 2.4 — August 25, 2026

## Origin

I built BetaGrace because existing image-generation benchmarks mostly reward aesthetic quality or loose semantic similarity. Very few of them actually stress whether a model (or the system calling it) can simultaneously lock a large number of precise, verifiable constraints — left/right laterality, exact text placement and material, dual lighting temperatures, specific micro-details, object states, etc.

I wanted a harder test: dense prompts (N = 13–16, plus an N = 23 extension) scored with zero tolerance. One missing or unverifiable critical constraint = fail, even if the image looks great.

ORIGIN STORY:  
Reached with no prior coding experience, no ControlNet, no custom datasets, and a free Pollinations endpoint.  
Configuration lost -> Realization of gold-standard text-to-image adherence -> Three weeks of chasing ghost code -> Rebuilt build nearest to Aug 2 state -> Returned stronger than the original peak.  


BetaGrace is the external orchestration / prompting layer I developed to push an otherwise standard hosted image model toward that level of constraint adherence. This benchmark is the record of that experiment.

## What This Package Is

This is the public release of the BetaGrace constraint-locking evaluation.

- **Canonical test set**: 27 concepts  
- **Strict scoring**: zero-tolerance visual verification  
- **Main result**: 20 / 27 concepts passed (81.5 %) under the documented rules  
- **Head-to-head extension**: two especially dense prompts (N=16 and N=23) run against native pipelines with fixed attempt budgets

All detailed methodology, the full 27-row matrix, failure analysis, attempt accounting, A/B control notes, and head-to-head breakdowns live in the master report. This README only covers orientation and packaging.

## Core Rule (for quick reference)

A generation is a **PASS** only when every critical positive constraint is present and visually verifiable.  
One material failure = **FAIL**. No partial credit. ASPECT RATIO WAS EXCLUDED FROM THE PASS/FAIL METRIC.

## Package Contents

| File / Folder | Purpose |
|---------------|---------|
| `BetaGrace_Benchmark_Master_Report_v2_4_Cleaned.docx` | Full methodology, metrics, matrix, failures, controls, and head-to-head results |
| `BetaGrace_27_Canonical_Prompt_Table.xlsx` | Frozen prompt list for the 27 canonical concepts |
| `Passes/` | Images that achieved strict Pass under the zero-tolerance rules |
| `Fails/` | Images that failed one or more critical constraints |
| `Public_image_logs_for_Postgresql_CLEAN.zip` | Cleaned generation logs retained for verification |
| `README.txt` | This file |

## How to Use / Reproduce

1. Read the master report for the exact scoring rules and claim boundaries.  
2. Use the canonical prompt table (`.xlsx`) as the frozen test set.  
3. Generate under your own system and score against the same zero-tolerance checklist.  
4. Compare results only under matching attempt budgets and the same visual verification standard.

## Claim Boundary (short version)

This benchmark shows that, under the documented prompts, endpoints, attempt budgets, and strict scoring rules, the BetaGrace orchestration layer produced higher observed constraint-locking success than the native pipelines it was tested against.

It does **not** claim:
- that the underlying image model was modified or retrained
- universal superiority across all prompts or future model versions
- statistical dominance from the small head-to-head sample

See Section 19 of the master report for the full, carefully worded claim boundary.

## License / Attribution

Prompts and evaluation framework © 2026 the author.  
Generated images remain subject to the terms of the underlying model providers used at the time of generation.

If you use or build on this benchmark, please cite the version and link to the original release.