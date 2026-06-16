## 问题
commit `6dc97bd` 在 `manifest.json` 新增了两个 scope：
- `chat:write.customize`
- `users:read.email`

但**全仓没有任何代码使用这两个 scope 对应的 Slack API**：
- `chat:write.customize` 用途是 per-message 自定义 `username` / `icon_emoji` / `icon_url`。`grep -rn "icon_emoji\|icon_url\|chat:write.customize" src/` → 0 处使用。
- `users:read.email` 用途是 `users.profile.getEmail` / `users.lookupByEmail`。`grep -rn "users:read.email\|getEmail\|lookupByEmail" src/` → 0 处使用。

而**真正修复 #59 需要的 `link_names: true` 参数只需 `chat:write` scope**（manifest 已有），不需要任何新 scope。

## 现状（manifest.json:55-70）
```diff
   "chat:write",
+  "chat:write.customize",   ← 未使用
   "commands",
   ...
-  "users:read"
+  "users:read",
+  "users:read.email"        ← 未使用
```

## 影响
- **违反"安全第一"原则**（user profile 已写明）：最小权限原则要求 scope 集合是当前代码实际需要的并集，不多给。
- **不必要的 Reinstall App 阻塞**：Slack manifest scope 变更强制要求 Reinstall App。如果用户已经安装并保存了 tokens，每次 reinstall 都会短暂中断 gateway 推送。Dev 在 issue #59 / thread 里也明确说"scope 变更 → Reinstall App（必须）"。为两个**未使用**的 scope 走一遍 Reinstall 是无谓的运维成本。
- **审计噪音**：未来安全审计看到 `users:read.email` 会以为在用 — 实际是 dead scope，污染 git history。
- **未来隐患**：若有人未来要给 reply 加 icon，结果发现 scope 已在 manifest 里，**就直接用**了 — 跳过了"我真的需要这个权限吗"的判断环节。

## 修法
从 `manifest.json` 删掉这两个 scope，回到 dev 提交前的状态：

```diff
   "chat:write",
-  "chat:write.customize",
   "commands",
   ...
   "users:read",
-  "users:read.email"
```

如果未来代码需要，再单独提 PR、加 scope、Reinstall App。

## 验收
- `diff <(grep -A20 oauth_config manifest.json) <(git show 6dc97bd^:manifest.json | grep -A20 oauth_config)` → 无 scope 差异
- `grep -rn "icon_emoji\|icon_url\|getEmail\|lookupByEmail" src/` 命中 0 处

## 关联
- Commit: `6dc97bd`
- PR: #53
- 父 issue: #59
- REVIEW: `docs/tests/REVIEW-MentionNotification-2026-06-14-xiaoma.md`
