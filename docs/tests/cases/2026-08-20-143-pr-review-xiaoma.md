# PR #143 Review — 日志滚动与 chorusgate log --agent（v5/logging-liveness）

- **Reviewer**: 小马 (ainizehermes, 工号002, 集成&测试)
- **日期**: 2026-08-20 16:10–16:25 CST
- **PR head at review**: d3d0b5c → 清理后 17d05c9
- **Base**: main (7e80978)
- **规模**: 63 commits, +13184/−704, 96 files

## 1. 测试实跑（temp worktree, 非主工作区）

```
npm test → # tests 377 / pass 373 / fail 4
```

4 个失败全部位于 `tests/codex-integration.test.ts`（ST-CX-001/002/004/005，
codex `--json` flag / CJK stdin / MAX_ITERATIONS 断言）。

**基线对照**：在 main (7e80978) worktree 上单独跑同一文件 → 同样 4 fail / 2 pass。
**结论：预存失败，非本 PR 引入。** 该测试文件断言的是 codex CLI 行为，main
上即已红，与本 PR 的 logging/liveness 改动无关。建议另开 issue 跟踪修复。

## 2. 调试残留文件（已由本次 review 修复）

分支上被意外提交的 3 个调试文件（均不在 main，源自 #134 时代 faeb2a6）：

| 文件 | 内容 | 处置 |
|------|------|------|
| `t2.txt` | node:test 递归警告输出 | 删除 + gitignore |
| `test-out.txt` | npm test 输出重定向 | 删除 + gitignore |
| `min.test.ts` | `assert.equal(1,1)` 占位测试 | 删除 + gitignore |

修复 commit: **17d05c9** `chore(#143): remove accidentally committed debug scratch files...`
（`git rm --cached` 保留本地文件 + .gitignore 追加，防止再次误提交。）

`.tmp_prompt.txt` 已存在于 main（pre-existing），本 PR 未新增，未动。

## 3. PR 范围观察（供 merge 决策，非阻塞）

- 63 commits 混合了 #141（logging/liveness 本体）、#147（连接韧性）、
  #148（timer ref / watchdog 修复）、#149（小克日报自动化）、#134/#135/#140（agent profile）多条线。
- 其中 #141 已有 SIT 报告（2026-08-19-141-logging-sit-report）、#148 已 FULL PASS
  复核（2026-08-20-148-d2d3-linux-recheck）、#149 Linux 侧 SIT PASS（2026-08-20，Windows 首跑约定 8/21 09:05）。
- 即：分支内容均已分线验证，问题只在 git 历史混合。是否整批 merge 或拆分，请乐老板定夺。

## 4. 结论

- 测试：✅ 373/377，4 失败为 main 预存（已甄别，与本 PR 无关）
- 卫生：✅ 调试残留已清理（17d05c9）
- 建议：merge 策略（整批 vs 拆分）待乐老板决策；codex-integration 4 个预存失败建议开新 issue 跟踪
