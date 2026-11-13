# Exhibit registration handoff

This branch keeps the shared registry untouched. Its current `src/registry.ts`
contains exhibits 01–06; the seven implementations below are ready to register
when the parallel website integration is reconciled.

| Number | ID | Component | Category |
| --- | --- | --- | --- |
| 07 | `gravity` | `GravityPlayground` | `Space` |
| 08 | `machine` | `InsideMachine` | `Computing` |
| 09 | `neural` | `NeuralNetworks` | `Computing` |
| 10 | `logic` | `LogicLaboratory` | `Electronics` |
| 11 | `forces` | `InvisibleForces` | `Physics` |
| 12 | `automata` | `CellularAutomata` | `Artificial Life` |
| 13 | `adder` | `Adder` | `Computing` |

Use lazy imports for these components, add their existing exhibit definitions
after 06, and include `Space`, `Computing`, and `Electronics` in the category
filter list. The existing identifiers and component exports are stable. The
standalone preview harness used for cross-exhibit QA has been removed.
