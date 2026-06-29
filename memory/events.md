| ts | channel | user | type | state | received_at | updated_at | retries | error | text_snippet |
|---|---|---|---|---|---|---|---|---|---|
| test-ts-1781962318092 | C01 | U01 | app_mention | replied | 1781962318092 | 1781962318092 | 0 | - | hello test |
| test-fail-1781962318095 | C02 | U02 | message | pending | 1781962318095 | 1781962318095 | 1 | timeout error | fail test |
| test-replay-pending-1781962318096 | C03 | - | app_mention | pending | 1781962318096 | 1781962318096 | 0 | - | pending |
| test-replay-stale-1781962318096 | C04 | - | message | processing | 1781962318096 | 1781961718096 | 0 | - | stale |
| test-fresh-1781962318097 | C05 | - | message | processing | 1781962318097 | 1781962318097 | 0 | - | fresh |
| test-count-failed-1781962318098 | C99 | - | message | failed | 1781962318098 | 1781962318098 | 0 | test error | fail |
| test-count-replied-1781962318098 | C99 | - | message | replied | 1781962318098 | 1781962318098 | 0 | - | ok |
| 1782031483.042379 | C0BB035G3DK | U0AHDRREVPD | app_mention | replied | 1782031484405 | 1782031528914 | 0 | - | 迭代四结束， <@U0B91BVKTL2> ， <@U0B8VHLHJAX> ， <@U0BAGFVD8VB> 。 |
| 1782031600.070369 | C0BB035G3DK | U0AHDRREVPD | app_mention | replied | 1782031602614 | 1782031644708 | 0 | - | <@U0BAGFVD8VB> ， 增强下报告， 和迭代三一样， 把多 碳基员工协同作为主要。 可以把chorusgate_v4 channel中项目沟通， 主举 |
| 1782031612.991379 | C0BB035G3DK | U0B91BVKTL2 | app_mention | replied | 1782031614678 | 1782031675979 | 0 | - | 根据刚才查到的信息：  - *commit '1791375'* — 小马的三份文档已推送（executive / testing / user-manual） |
