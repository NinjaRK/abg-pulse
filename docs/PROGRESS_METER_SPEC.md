# Progress Meter specification

The public Job Meter has four numbers:

1. **Verified complete** — weighted work that has passed its acceptance evidence.
2. **Built, awaiting verification** — implementation that exists but still needs live or independent proof.
3. **Remaining to verify** — 100 minus verified complete; this remains the governing distance to the objective.
4. **Blocked or time-bound** — the portion of remaining work currently dependent on account access, data rights, governance or elapsed live operation.

The headline percentage is always **Verified complete**. Built-but-unverified work is never added to it.

Current v6 baseline:

- Verified complete: 40%
- Built, awaiting verification: 8%
- Remaining to verify: 60%
- Blocked or time-bound within the remainder: 18%
