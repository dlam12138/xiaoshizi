import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const serviceEnv = parse(fs.readFileSync('.env.import.local', 'utf8'));
const publicEnv = parse(fs.readFileSync('.env.local', 'utf8'));
const url = serviceEnv.SUPABASE_URL;
const service = createClient(url, serviceEnv.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const outDir = path.join('temp', 'supabase-local', 'security-audit');
fs.mkdirSync(outDir, { recursive: true });

const users = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  users.push(...data.users);
  if (data.users.length < 1000) break;
}

async function readAll(table, columns = '*') {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await service.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

const reviews = await readAll('reviews');
const admins = await readAll('admin_users');
const transactions = await readAll('point_transactions');

const domain = (email) => String(email || '').toLowerCase().split('@').pop() || '';
const isStudent = (email) => domain(email) === 's.upc.edu.cn';
const normalizedEmails = new Map();
for (const user of users) {
  const key = String(user.email || '').toLowerCase();
  normalizedEmails.set(key, (normalizedEmails.get(key) || 0) + 1);
}

const duplicateMap = new Map();
for (const review of reviews) {
  if (!review.user_id) continue;
  const key = [review.user_id, review.teacher_id, review.course_id, review.term_id].join('|');
  duplicateMap.set(key, (duplicateMap.get(key) || 0) + 1);
}
const duplicateGroups = [...duplicateMap.entries()].filter(([, count]) => count > 1);
const orphanReviewRewards = transactions.filter((tx) => tx.action_code === 'review_approved' && !tx.related_review_id);
const adminByEmail = new Map(admins.map((row) => [String(row.email || '').toLowerCase(), row]));
const unboundAdmins = admins.filter((row) => !users.some((user) => String(user.email || '').toLowerCase() === String(row.email || '').toLowerCase()));

let authSettings = null;
try {
  const response = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: publicEnv.VITE_SUPABASE_ANON_KEY },
  });
  authSettings = await response.json();
} catch (error) {
  authSettings = { unavailable: String(error?.message || error) };
}

const detailed = {
  generatedAt: new Date().toISOString(),
  environment: 'local-native-supabase',
  accountDomains: users.reduce((acc, user) => {
    const key = domain(user.email) || '(empty)';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}),
  nonStudentAccounts: users.filter((user) => !isStudent(user.email)).map((user) => ({
    id: user.id, email: user.email, confirmed: Boolean(user.email_confirmed_at),
    created_at: user.created_at,
  })),
  unconfirmedAccounts: users.filter((user) => !user.email_confirmed_at).map((user) => ({
    id: user.id, email: user.email,
  })),
  duplicateBusinessGroups: duplicateGroups.map(([key, count]) => ({ key, count })),
  adminRows: admins.map((row) => ({
    id: row.id, email: row.email, role: row.role, is_active: row.is_active,
    matched_auth_user: Boolean(adminByEmail.get(String(row.email || '').toLowerCase())),
  })),
  reviewOrphans: reviews.filter((review) => review.user_id && !users.some((user) => user.id === review.user_id)).map((review) => review.id),
  reviewComments: reviews.filter((review) => String(review.comment || '').trim()).map((review) => review.id),
  customNicknames: reviews.filter((review) => review.author_nickname && review.author_nickname !== '匿名石大学子').map((review) => review.id),
  orphanRewardTransactions: orphanReviewRewards.map((tx) => ({ id: tx.id, user_id: tx.user_id, amount: tx.amount })),
  authSettings,
};
const detailedFile = path.join(outDir, 'audit-detail.json');
fs.writeFileSync(detailedFile, `${JSON.stringify(detailed, null, 2)}\n`, { mode: 0o600 });
const digest = createHash('sha256').update(fs.readFileSync(detailedFile)).digest('hex');

const summary = {
  generatedAt: detailed.generatedAt,
  environment: detailed.environment,
  authUsers: users.length,
  confirmedUsers: users.filter((user) => user.email_confirmed_at).length,
  studentDomainUsers: users.filter((user) => isStudent(user.email)).length,
  nonStudentUsers: detailed.nonStudentAccounts.length,
  unconfirmedUsers: detailed.unconfirmedAccounts.length,
  duplicateNormalizedEmails: [...normalizedEmails.values()].filter((count) => count > 1).length,
  adminRows: admins.length,
  adminsWithoutMatchingAuthUser: unboundAdmins.length,
  reviews: reviews.length,
  duplicateReviewBusinessGroups: duplicateGroups.length,
  reviewsWithNonEmptyComment: detailed.reviewComments.length,
  reviewsWithCustomNickname: detailed.customNicknames.length,
  reviewsWithMissingAuthUser: detailed.reviewOrphans.length,
  reviewRewardTransactions: transactions.filter((tx) => tx.action_code === 'review_approved').length,
  orphanReviewRewardTransactions: orphanReviewRewards.length,
  authProviders: authSettings && !authSettings.unavailable ? {
    email: authSettings.external?.email,
    phone: authSettings.external?.phone,
    anonymous: authSettings.external?.anonymous_users,
    providers: authSettings.external?.providers || [],
  } : { unavailable: true },
  detailFile: detailedFile.replaceAll('\\', '/'),
  detailSha256: digest,
};
fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'SUMMARY.md'), [
  '# SEC-01 只读审计摘要',
  '',
  `生成时间：${summary.generatedAt}`,
  `环境：${summary.environment}`,
  '',
  '| 项目 | 计数 |',
  '| --- | ---: |',
  `| Auth 账户 | ${summary.authUsers} |`,
  `| 已确认 | ${summary.confirmedUsers} |`,
  `| 学生域账户 | ${summary.studentDomainUsers} |`,
  `| 非学生域账户 | ${summary.nonStudentUsers} |`,
  `| 未确认账户 | ${summary.unconfirmedUsers} |`,
  `| 管理员行 | ${summary.adminRows} |`,
  `| 管理员未匹配 Auth 主体 | ${summary.adminsWithoutMatchingAuthUser} |`,
  `| 评价 | ${summary.reviews} |`,
  `| 重复业务组合 | ${summary.duplicateReviewBusinessGroups} |`,
  `| 非空文字评价 | ${summary.reviewsWithNonEmptyComment} |`,
  `| 自定义公开昵称 | ${summary.reviewsWithCustomNickname} |`,
  `| 评价关联缺失 | ${summary.reviewsWithMissingAuthUser} |`,
  `| 评价奖励流水 | ${summary.reviewRewardTransactions} |`,
  `| 评价关联已丢失的奖励流水 | ${summary.orphanReviewRewardTransactions} |`,
  '',
  `敏感明细：${summary.detailFile}（Git 忽略），SHA-256 \`${summary.detailSha256}\`。`,
  '',
  '结论：本摘要只含计数和问题类型；账户邮箱、账户 ID、评价 ID 和奖励明细均未写入仓库。',
  '',
].join('\n'));

console.log(JSON.stringify(summary, null, 2));
