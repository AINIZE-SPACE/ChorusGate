| ts | channel | user | type | state | received_at | updated_at | retries | error | text_snippet |
|---|---|---|---|---|---|---|---|---|---|
| test-ts-1781962318092 | C01 | U01 | app_mention | replied | 1781962318092 | 1781962318092 | 0 | - | hello test |
| test-fail-1781962318095 | C02 | U02 | message | pending | 1781962318095 | 1781962318095 | 1 | timeout error | fail test |
| test-replay-pending-1781962318096 | C03 | - | app_mention | pending | 1781962318096 | 1781962318096 | 0 | - | pending |
| test-replay-stale-1781962318096 | C04 | - | message | processing | 1781962318096 | 1781961718096 | 0 | - | stale |
| test-fresh-1781962318097 | C05 | - | message | processing | 1781962318097 | 1781962318097 | 0 | - | fresh |
| test-count-failed-1781962318098 | C99 | - | message | failed | 1781962318098 | 1781962318098 | 0 | test error | fail |
| test-count-replied-1781962318098 | C99 | - | message | replied | 1781962318098 | 1781962318098 | 0 | - | ok |
