# Review agent audit

## Summary

Finding a1: Test statistics leak into augmentation search. Confirmed with out/check_split.csv.
Finding a2: Checkpoint selection uses the test split. Confirmed by the same selection loop.
Finding a3: Random seed is reset in the training loop.

## Notes

- This is synthetic fixture data for the evidence viewer.
- It is not a real review result.
