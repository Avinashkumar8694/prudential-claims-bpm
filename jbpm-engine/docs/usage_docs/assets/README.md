# Asset Reference

Assets live at the **project** level (Assets tab), shared by every process in that project, and are
referenced from node fields by name — e.g. a [User Task](../nodes/user-task.md)'s `form`, a
[Business Rule](../nodes/rule.md)'s `ruleflowGroup`/`dmn.model`/`decisionTree`/`scorecard`, a
[Send](../nodes/send.md)/[Receive](../nodes/receive.md)'s `message`.

| Kind | Key | Used by | Exports as |
|---|---|---|---|
| [Forms](forms.md) | `forms` | [User Task](../nodes/user-task.md) `form` | `.form` |
| [DRL rules](rulesets-drl.md) | `rulesets` | [Business Rule](../nodes/rule.md) `ruleflowGroup` | `.drl` |
| [DMN decisions](decisions-dmn.md) | `decisions` | [Business Rule](../nodes/rule.md) `dmn.model` | `.dmn` |
| [Decision tables](guided-tables.md) | `guidedTables` | Business Central-style guided rules (compiled to DRL) | `.gdst` |
| [Decision trees](decision-trees.md) | `decisionTrees` | [Business Rule](../nodes/rule.md) `decisionTree` | `.gdt` |
| [Scorecards](scorecards.md) | `scorecards` | [Business Rule](../nodes/rule.md) `scorecard` | `.scgd` |
| [Enumerations](enumerations.md) | `enumerations` | Form/field dropdown value lists | — |
| [Data types](types.md) | `types` | Variable/form/rule fact shapes | `.java` |
| [Messages](messages.md) | `messages` | [Send](../nodes/send.md)/[Receive](../nodes/receive.md)/[Throw](../nodes/throw.md)/[Catch](../nodes/catch.md) correlation | — |
| [Test scenarios](tests.md) | `tests` | Given/expect test cases for a decision or process | `.scesim` |

Every kind shares the same CRUD shape (`AssetsService`): list by kind, get/update/delete one by
`(kind, name)`, and a delete is **blocked (409)** while any process node still references it — you
can't accidentally delete a form/ruleset/decision that's still wired into a live process.

Each kind also has a **structured field editor** in the Assets tab (not raw JSON) — see each kind's
own doc for what that editor exposes.
