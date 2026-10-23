# UPC 反馈/纠错机制审查

审查日期：2026-10-23。只读审查，未新增反馈系统。

## 结论

原项目**没有教师/课程数据纠错或内容反馈闭环**。现有名字中带 “feedback/反馈” 的代码
都是加载状态、错误重试或操作结果提示；管理员审核只针对学生评价，不处理教师/课程
身份或课程归属纠错。

## 代码证据

- `src/components/Pagination.tsx:5-29`：`PageFeedback` 接收
  `loading/error/onRetry`，仅渲染“正在同步/读取失败/重试”，没有表单或提交。
- `src/App.tsx:78-90`：`appToast` 是全局成功/信息/错误提示，不收集内容。
- `src/components/AdminAuditModal.tsx:61-75, 235-261`：管理员分区是
  `reviews`/`admins`，操作是评价通过、驳回和用户配置；没有教师/课程纠错队列。
- `supabase/upc-init.sql:17-170`：业务表为 `colleges/courses/terms/teachers/
  course_offerings/admin_users/user_profiles/point_rules/point_transactions/
  reviews/review_likes/import_batches`，没有 feedback/correction/report 表。
- `server` 目录未发现反馈/纠错 API；只有健康检查和现有业务接口。
- 结果：用户即使发现“某课程被推断到某老师”或“某教师学院/课程错误”，当前没有
  可信的提交入口，也没有仅本人+管理员可读的存储。

## 最小纠错闭环建议（本轮不实施）

1. 新增 `content_corrections`：
   - `id uuid`, `user_id uuid REFERENCES auth.users`,
   - `entity_type text CHECK IN ('teacher','course','offering')`,
   - `entity_id text`, `field text`, `current_value text`,
   - `suggested_value text`, `reason text`, `evidence_url text`,
   - `status text CHECK IN ('pending','accepted','rejected')`,
   - `reviewer_id uuid REFERENCES admin_users`, `reviewed_at`, `created_at`.
2. RLS：
   - 登录用户只能 `INSERT` 自己的、只能 `SELECT` 自己的；
   - 管理员（`admin_users`）可读取全部、更新 `status/reviewer_id/reviewed_at`；
   - 不把 service_role 放前端。
3. API/UI：
   - 详情页教师/课程上下文放一个小的“纠错”链接；
   - 未登录先登录，提交后只显示“已提交审核”；
   - `AdminAuditModal` 增加“数据纠错”页签，和评价审核分开；
   - 接受后由管理员走受控的数据更新/重导入，不让用户直接改业务表。
4. 数据侧 provenance：
   - 本轮 3 条研究方向推断已记录在
     `scripts/upc-timetable/same-name-reconciliation.json` 和
     `data/upc/timetables-2026-2027-1/inferred-course-assignments.json`，
     含 `method/confidence/officialConfirmation/correctable/alternativeSourceId`；
   - 不把推断写成官方确认；后续如有纠错系统，可直接引用这些 JSON 作为可纠正依据。
