# Data Object / Data Store — properties

| Property | XML | Notes |
|----------|-----|-------|
| dataObject id / name | `<bpmn2:dataObject>` | |
| itemSubjectRef | type via `itemDefinition` | optional |
| isCollection | `@isCollection` | true for lists |
| dataStoreReference id / name / dataStoreRef | `<bpmn2:dataStoreReference>` | -> `<bpmn2:dataStore>` |

## SDK
`process.dataObjects: [{ id, name, type, isCollection }]`
`process.dataStores:  [{ id, name, dataStoreRef }]` (emits a `<bpmn2:dataStore>` + reference)
