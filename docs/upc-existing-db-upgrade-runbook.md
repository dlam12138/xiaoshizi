# 现有库五补丁升级操作单（WSL 目标库已执行）

更新：2026-10-24。适用对象：本机现有 UPC Supabase 数据库（已执行旧版
`20261024-security-governance.sql`，本轮五份最新补丁已执行）。
**2026-10-24 18:xx 已对 WSL 原库 `0499...`（54321/54322）执行五份补丁**；升级前备份、
恢复核对、post-check 和数据计数见 `docs/upc-security-delivery.md` 第 11 节。
本操作单继续作为云端/其他目标库的可复用步骤；执行仍需运营者授权和维护窗口。
2026-10-24 已对升级前库执行 `20261024-preflight.sql` 只读预检（exit 0）：旧代录 RPC 存在、
纠错 RPC/表不存在、重复组 0、计数 6/1,555/1,342/2,946/1/0/14/0/1。

## 1. 目标与禁止事项

目标库特征（2026-10-24 只读检查）：

- 6 个 Auth 用户、1,555 教师、1,342 课程、2,946 开课关系、1 条评价、0 条治理申请、
  14 条积分流水、0 个点赞、1 个管理员；
- 旧 `create_proxy_teacher_appeal` 存在；
- 无 `apply_governance_correction`、无纠错台账/保护钉；
- `reviews_business_key_uidx` 仍是无 `withdrawn` 条件的旧索引；
- 旧管理员绑定域为 `example.test`，**已于 2026-10-24 停用**；账户/角色/MFA 保留，但不再有管理员权限。

禁止：

- 对现有库执行 `upc-init.sql`、`supabase db reset`、清空/覆盖/恢复覆盖；
- 自动撤销/改绑旧管理员，或删除历史账户；
- 向真实 Gmail/学生邮箱发测试信；
- 用旧 `20261023-four-point-rating.sql` 回退以重新开放身份、精确时间、评论或低门槛评分；
- 在未备份、未验证目标库、未确认重复业务组为 0 时开始。

## 2. 目标校验（只读）

在维护窗口前执行：

```powershell
$env:PGPASSWORD = '<从本地凭据读取，不写入仓库>'
psql "host=127.0.0.1 port=54322 dbname=postgres user=postgres" -c "\conninfo"
psql "host=127.0.0.1 port=54322 dbname=postgres user=postgres" -c "select current_database(), current_user;"
```

必须确认：

- 连接的是现有本机库，不是隔离栈（隔离栈端口为 54422）、不是云端项目；
- `current_database()` 与预期一致；
- 当前分支为 `feat/launch-security-governance`，五份补丁文件与本操作单同一版本；
- 记录五份文件和本操作单的 SHA-256：

```powershell
Get-FileHash supabase/upgrades/20261024-security-governance.sql, `
  supabase/upgrades/20261024-owner-admin-policy.sql, `
  supabase/upgrades/20261024-governance-boundary.sql, `
  supabase/upgrades/20261024-remove-teacher-appeal.sql, `
  supabase/upgrades/20261024-governance-correction-closure.sql -Algorithm SHA256
```

## 3. 只读前置检查

```powershell
psql "host=127.0.0.1 port=54322 dbname=postgres user=postgres" `
  -v ON_ERROR_STOP=1 -f supabase/upgrades/20261024-preflight.sql
```

预期（与 2026-10-24 只读检查一致）：

- `correction_rpc_absent = t`；
- `old_appeal_rpc_present = t`；
- `correction_ledger_absent = t`、`correction_pins_absent = t`；
- `duplicate_business_groups = 0`；
- 计数：`auth_users=6, teachers=1555, courses=1342, offerings=2946,
  reviews=1, approved_reviews=1, governance_requests=0,
  point_transactions=14, review_likes=0, admin_users=1`；
- 管理员域计数：`example.test = 1`；
- 旧 `review_feed` 若仍包含 `user_id/comment` 等列，记录下来，升级后必须消失。

**停止条件**：任一“必须为 0”的重复组非 0、基础表缺失、计数与记录不符、旧管理员行
未完成去留决定、目标库不是现有库。停止时不做任何写操作。

## 4. 维护窗口与锁影响

建议窗口：低峰期 30–60 分钟，应用进入维护页/只读；暂停导入任务、审核任务和后台写入。

- `security-governance`：创建/替换安全表、RLS、公开投影、审核/奖励/审计 RPC、
  治理表、Hook 函数；同时加入 `private.upc_session_is_current` 并把管理员校验绑定到
  `auth.sessions`（删除会话后旧 AAL2 token 立即失去管理员权限）。有 `ALTER TABLE`、
  约束和索引 DDL。
- `owner-admin-policy`：替换管理员邀请/角色函数，创建部分唯一索引；时间短。
- `governance-boundary`：先检查重复业务组，再 `DROP/CREATE` 非 withdrawn 唯一索引；
  需要短暂 `ACCESS EXCLUSIVE` 表锁，是主要锁点。
- `remove-teacher-appeal`：删除旧函数并安装类型守卫；不重写历史行。
- `governance-correction-closure`：创建两张私有表/索引、替换队列视图和状态/写回 RPC、
  替换导入 RPC；不重写业务数据。

在 `psql` 会话中设置保护：

```sql
SET lock_timeout = '5s';
SET statement_timeout = '15min';
```

锁等待超时会中止当前补丁事务，不会留下半套 DDL；释放长事务后重试。

## 5. 备份与恢复核对

```powershell
$stamp = Get-Date -Format 'yyyyMMddTHHmmZ'
$dir = "temp/security-backups"
New-Item -ItemType Directory -Force $dir | Out-Null
pg_dump "host=127.0.0.1 port=54322 dbname=postgres user=postgres" `
  --format=custom --no-owner --no-privileges `
  --file "$dir/upc-existing-$stamp.dump"
pg_dump "host=127.0.0.1 port=54322 dbname=postgres user=postgres" `
  --schema-only --no-owner --no-privileges `
  --file "$dir/upc-existing-schema-$stamp.dump"
Get-FileHash "$dir/upc-existing-$stamp.dump", "$dir/upc-existing-schema-$stamp.dump" -Algorithm SHA256
pg_restore --list "$dir/upc-existing-$stamp.dump" | Select-Object -First 20
```

必须：

1. 记录完整库和 schema 备份的 SHA-256；
2. 在独立临时库恢复完整备份，核对第 3 节计数和关键对象，确认备份可用；
3. 确认备份目录被 Git 忽略，不提交任何 dump；
4. 备份完成前不得开始执行补丁。

## 6. 逐文件执行（失败即停）

在维护窗口、目标校验和备份核对通过后，逐条执行；不要用一条命令串联五个文件。

```powershell
psql "host=127.0.0.1 port=54322 dbname=postgres user=postgres" `
  -v ON_ERROR_STOP=1 -f supabase/upgrades/20261024-security-governance.sql
# 退出码必须为 0，且看到 COMMIT；否则立即停止

psql "host=127.0.0.1 port=54322 dbname=postgres user=postgres" `
  -v ON_ERROR_STOP=1 -f supabase/upgrades/20261024-owner-admin-policy.sql
# 退出码必须为 0，且看到 COMMIT；否则立即停止

psql "host=127.0.0.1 port=54322 dbname=postgres user=postgres" `
  -v ON_ERROR_STOP=1 -f supabase/upgrades/20261024-governance-boundary.sql
# 退出码必须为 0，且看到 COMMIT；否则立即停止

psql "host=127.0.0.1 port=54322 dbname=postgres user=postgres" `
  -v ON_ERROR_STOP=1 -f supabase/upgrades/20261024-remove-teacher-appeal.sql
# 退出码必须为 0，且看到 COMMIT；否则立即停止

psql "host=127.0.0.1 port=54322 dbname=postgres user=postgres" `
  -v ON_ERROR_STOP=1 -f supabase/upgrades/20261024-governance-correction-closure.sql
# 退出码必须为 0，且看到 COMMIT；否则立即停止
```

每个文件自带 `BEGIN/COMMIT`。不要加 `-1` 再包一层事务，也不要在失败后盲目重跑
同一文件；先看第 8 节。

## 7. Auth 配置与重启

SQL 补丁不会自动让 GoTrue 使用新 Hook/MFA 设置。执行完五个文件后：

1. 按 `docs/upc-auth-setup.md` 更新 `supabase/config.toml` 的 Auth Hook、MFA 和
   redirect allow list；
2. 停止并重新启动本机 GoTrue/Supabase 栈；
3. 检查 Auth 启动日志无 Hook 错误；
4. 用现有合成测试账户验证学生域注册/确认和 Gmail 管理员邀请；**不得向真实邮箱发信**；
5. 若 Auth 启动失败，先恢复配置并重启，不要回滚数据库。

## 8. 升级后验收

```powershell
psql "host=127.0.0.1 port=54322 dbname=postgres user=postgres" `
  -v ON_ERROR_STOP=1 -f supabase/upgrades/20261024-postcheck.sql
```

必须：

- `correction_rpc = t`、`mfa_recovery_rpc = t`、`admin_session_guard = t`、
  `old_appeal_rpc_present = f`；
- `correction_ledger = t`、`correction_pins = t`、`review_guard_trigger = t`；
- `reviews_business_key_uidx` 含 `status <> 'withdrawn'`；
- `duplicate_business_groups = 0`；
- 保护表 `rls_enabled = t` 且策略数 > 0；
- `review_feed` 不含 `user_id`、`comment`、`email` 等身份/正文列；
- `anon_can_apply_correction = f`、`authenticated_can_apply_correction = t`；
- `authenticated_can_call_session_guard = f`；
- `anon_can_recover_mfa = f`、`authenticated_can_recover_mfa = f`、
  `service_role_can_recover_mfa = t`；
- 业务计数与第 3 节一致（教师/课程/关系/评价/申请/积分等升级不应改变）；
  Auth/管理员计数只允许因运营者批准的引导账号变化；
- 首次升级纠错台账/保护钉为 0（现有库无纠错申请时）；
- 管理员行仍为 1，`example.test` 仍在，等待运营者决定；
- `require_admin_aal2 = true`、`min_independent_reviews = 5`、`review_rate_seconds = 60`。

然后做只读页面 smoke：教师/课程搜索、详情、空状态；用合成账户验证登录、签到、评分、
审核、纠错、举报、撤回、删除。**现有库的历史账户不用于新增评价或真实邮件测试。**
完整 Auth/邮件闭环应在独立项目或隔离栈完成后再算云端验收。

## 9. 失败与成功后恢复（分开处理）

### 9.1 某个文件执行失败

- 该文件事务自动回滚；此前文件已提交，属于“部分升级”，不是“全失败”。
- 立即停止，不执行后续文件，不重复跑失败文件。
- 运行 `20261024-postcheck.sql` 判断哪些对象已存在、哪些缺失；
- 修复原因（锁超时、重复组、权限、SQL 错误）后，从失败文件继续；若无法确认
  部分状态，恢复第 5 节备份到独立库核对，再按维护窗口恢复现有库。
- 不要用旧评分 SQL 或完整 init 作为“回退”。

### 9.2 五个文件成功但上线后发现功能/性能问题

- 优先关闭写入/公开评分，保留目录只读检索；
- 在独立库恢复备份并复现问题，确认是数据、RLS、RPC 还是 Auth Hook；
- 前向修复用新的可审查补丁；不要直接改现有库对象；
- 若必须恢复备份：先停止应用写入，记录当前库备份，恢复迁移前备份，再重启 Auth；
- 恢复后不得重新开放非学生注册、公开身份、文字评论或低于 5 人的评分；
- 审计日志、纠错台账、注销记录按保留策略处理，不因回退删除。

### 9.3 Auth 配置回退

恢复上一版 `config.toml`，停止/启动 GoTrue，验证 Hook 不再调用新函数；数据库补丁
可保留（函数幂等/向后兼容），不要为了回退 Auth 而恢复旧数据库。

## 10. 真实 Gmail 管理员引导（独立步骤）

1. 运营者私下提供 Gmail 地址；不写入 Git、不放入公开聊天。
2. 用受控 service role 写入一次性私有邀请：

```sql
INSERT INTO private.upc_admin_invites(email, expires_at)
VALUES ('<owner-gmail>', now() + interval '1 hour');
```

3. 运营者在 Gmail 收信并完成注册/确认；确认后查询稳定 Auth `user_id`，不要在 SQL
   中按邮箱猜角色。
4. 由受控后台写入管理员行（初始引导，不经过公开 RPC）：

```sql
INSERT INTO public.admin_users(user_id, email, role, nickname, is_active)
VALUES ('<auth-user-id>', '<owner-gmail>', 'super_admin', '<operator-label>', true);
```

5. 管理员登录后立即绑定 TOTP，完成一次 AAL2；再用 `create_admin_invite` 邀请后续管理员。
6. 记录管理员 user_id、角色、邀请时间和操作人；不记录邮件正文或 TOTP 密钥。

旧管理员去留（2026-10-24 已由运营者决定停用，账户/角色/MFA 保留）：

- 保留：不改行；确认其仍符合新 Gmail 策略后再决定是否长期保留；
- 停用：`UPDATE public.admin_users SET is_active = false WHERE user_id = '<old-id>';`
  保留行和审计，不删除；
- 重建：先停用旧行，再按上面步骤创建新 Gmail 管理员；不要只改 email 字段。

## 11. 管理员 MFA 丢失恢复

仅用于合成演练或经身份核验的真实管理员，**不是公开自助入口**：

```powershell
# 1) 只读预检：列出目标管理员、角色、factor 数量和类型
$env:UPC_ENV_FILE = '.env.import.local'
node scripts/recover-admin-mfa.mjs --user-id <admin-uuid> `
  --operator '<operator-label>' `
  --reason '<线下身份核验结论，至少 20 字>'

# 2) 运营者批准后执行；脚本删除全部 MFA factor、撤销会话、写入审计
node scripts/recover-admin-mfa.mjs --user-id <admin-uuid> `
  --operator '<operator-label>' `
  --reason '<线下身份核验结论，至少 20 字>' --execute --confirm
```

要求：

- 运行环境必须是受控后台，持有 service role；远程库需显式
  `UPC_ALLOW_REMOTE_MFA_RECOVERY=1` 和变更单；
- 管理员本人、普通用户、AAL2 管理员都不能调用审计 RPC；只有 service role 可以；
- 脚本不修改密码、角色或 active；恢复后管理员用原密码登录，重新绑定 TOTP 并验证 AAL2；
- 恢复删除 session/refresh token，旧 refresh 实测失效；管理员入口绑定 `auth.sessions`，
  旧 AAL2 access token 的审核/邀请/身份查询/管理投影立即被拒；普通用户接口仍可能接受
  未过期的签名 JWT，高风险场景可缩短 JWT TTL；
- 审计记录包含操作人、原因、factor 标识、撤销会话数、角色和 active，不含 TOTP 密钥；
- 隔离演练结果见 `docs/upc-sec-g0-acceptance.md` 和
  `temp/isolated-supabase/mfa-recovery-report.json`（Git 忽略）。

## 12. 签署与授权

| 项目 | 填写 |
| --- | --- |
| 执行人 | 本轮自动化执行（运营者授权） |
| 复核人 | 待填 |
| 维护窗口 | 2026-10-24 18:xx（WSL 目标库） |
| 目标库确认 | `0499...` / `127.0.0.1:54322` |
| 备份 SHA-256 | `adb427ec...0b2a`（完整库）；`a88d7ae7...51eb`（schema） |
| 旧管理员去留决定 | 已停用；账户/角色/MFA 保留，迁移不恢复权限 |
| 真实 Gmail 管理员 | `operator@example.com` 已建 Auth 账户和 `super_admin`，已激活并绑定 1 个 verified TOTP |
| 失败回退负责人 | 待填 |
| 执行授权 | WSL 目标库已执行；云端/其他库未授权 |
