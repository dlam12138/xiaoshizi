import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const envFile = process.env.UPC_ENV_FILE || '.env.import.local';
const env = parse(fs.readFileSync(envFile, 'utf8'));
const url = env.SUPABASE_URL;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('This destructive utility is restricted to a local loopback stack.');
}
const args = process.argv.slice(2);
const requestId = args.find((arg) => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--user-id');
const userOverride = args.includes('--user-id') ? args[args.indexOf('--user-id') + 1] : null;
const execute = args.includes('--execute');
const confirmed = args.includes('--confirm');
if (!requestId) {
  console.error('Usage: node scripts/process-account-deletion.mjs <request-id> [--user-id <uuid>] [--execute --confirm]');
  process.exit(2);
}
if (execute && !confirmed) {
  console.error('Refusing destructive execution without --execute --confirm. Run dry-run first.');
  process.exit(2);
}

const service = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const request = await service.from('governance_requests').select('*').eq('id', requestId).maybeSingle();
if (request.error) throw request.error;
if (request.data && request.data.request_type !== 'account_deletion') {
  throw new Error('Not an account deletion request');
}
if (request.data && request.data.status !== 'accepted') {
  throw new Error('Request must be accepted before deletion');
}
const userId = userOverride || request.data?.requester_user_id;
if (!userId) {
  throw new Error('Request has no Auth subject; use --user-id only for a documented retry of the same request');
}
if (userOverride && request.data?.requester_user_id && request.data.requester_user_id !== userOverride) {
  throw new Error('--user-id does not match the request subject');
}
const resume = Boolean(userOverride);
if (!request.data && !resume) throw new Error('Request not found');

const [profile, reviews, likes, points, requests, admin, authBefore] = await Promise.all([
  service.from('user_profiles').select('id,points', { count: 'exact' }).eq('id', userId),
  service.from('reviews').select('id', { count: 'exact' }).eq('user_id', userId),
  service.from('review_likes').select('review_id', { count: 'exact' }).eq('user_id', userId),
  service.from('point_transactions').select('id', { count: 'exact' }).eq('user_id', userId),
  service.from('governance_requests').select('id', { count: 'exact' }).eq('requester_user_id', userId),
  service.from('admin_users').select('id', { count: 'exact' }).eq('user_id', userId),
  service.auth.admin.getUserById(userId),
]);
for (const result of [profile, reviews, likes, points, requests, admin]) {
  if (result.error) throw result.error;
}
const reviewIds = (reviews.data || []).map((review) => review.id);
const requestIds = [...new Set([
  ...(request.data ? [requestId] : []),
  ...(requests.data || []).map((item) => item.id),
])];
const likesOnOwnReviews = reviewIds.length
  ? await service.from('review_likes').select('review_id', { count: 'exact', head: true }).in('review_id', reviewIds)
  : { count: 0, error: null };
if (likesOnOwnReviews.error) throw likesOnOwnReviews.error;
const authExists = !authBefore.error && Boolean(authBefore.data?.user);
const impact = {
  requestId,
  userIdCaptured: Boolean(userId),
  environment: 'local-loopback',
  execute,
  resume,
  counts: {
    profiles: profile.count || 0,
    reviews: reviews.count || 0,
    likesByUser: likes.count || 0,
    likesOnAuthoredReviews: likesOnOwnReviews.count || 0,
    pointTransactions: points.count || 0,
    governanceRequests: requestIds.length,
    adminBindings: admin.count || 0,
    authUserExists: authExists,
  },
  effects: execute ? [
    'auth.users row deleted first; login and old tokens stop resolving',
    'author reviews deleted; public feed and teacher statistics recalculated by triggers',
    'likes and point ledger rows cascade from auth/review/profile deletion',
    'the accepted governance request and its private event rows are deleted',
    'private durable reward markers and audit rows are retained as minimal anti-abuse records',
  ] : ['dry-run only; no database row was changed'],
  status: execute ? 'started' : 'dry-run',
};
const outDir = path.join('temp', 'security-backups');
fs.mkdirSync(outDir, { recursive: true });
const reportPath = path.join(outDir, `account-deletion-${requestId}${execute ? '-executed' : '-dry-run'}.json`);
fs.writeFileSync(reportPath, `${JSON.stringify(impact, null, 2)}\n`);

if (!execute) {
  console.log(JSON.stringify(impact, null, 2));
  console.log(`Dry-run report: ${reportPath}`);
  process.exit(0);
}

try {
  if (authExists) {
    const authDeleted = await service.auth.admin.deleteUser(userId);
    if (authDeleted.error) throw authDeleted.error;
  } else if (!resume) {
    throw new Error('Auth user is already missing; use --user-id for a documented retry');
  }

  for (const review of reviews.data || []) {
    const deleted = await service.from('reviews').delete().eq('id', review.id);
    if (deleted.error) throw deleted.error;
  }
  const profileDeleted = await service.from('user_profiles').delete().eq('id', userId);
  if (profileDeleted.error) throw profileDeleted.error;
  for (const id of requestIds) {
    const deleted = await service.from('governance_requests').delete().eq('id', id);
    if (deleted.error) throw deleted.error;
  }

  const [profileAfter, reviewsAfter, likesAfter, likesOnReviewsAfter, pointsAfter, requestsAfter, adminAfter, authAfter] = await Promise.all([
    service.from('user_profiles').select('id', { count: 'exact', head: true }).eq('id', userId),
    service.from('reviews').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    service.from('review_likes').select('review_id', { count: 'exact', head: true }).eq('user_id', userId),
    reviewIds.length
      ? service.from('review_likes').select('review_id', { count: 'exact', head: true }).in('review_id', reviewIds)
      : Promise.resolve({ count: 0, error: null }),
    service.from('point_transactions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    requestIds.length
      ? service.from('governance_requests').select('id', { count: 'exact', head: true }).in('id', requestIds)
      : Promise.resolve({ count: 0, error: null }),
    service.from('admin_users').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    service.auth.admin.getUserById(userId),
  ]);
  for (const result of [profileAfter, reviewsAfter, likesAfter, likesOnReviewsAfter, pointsAfter, requestsAfter, adminAfter]) {
    if (result.error) throw result.error;
  }
  const remaining = {
    authUserExists: !authAfter.error && Boolean(authAfter.data?.user),
    profiles: profileAfter.count || 0,
    reviews: reviewsAfter.count || 0,
    likesByUser: likesAfter.count || 0,
    likesOnAuthoredReviews: likesOnReviewsAfter.count || 0,
    pointTransactions: pointsAfter.count || 0,
    governanceRequests: requestsAfter.count || 0,
    adminBindings: adminAfter.count || 0,
  };
  const clean = Object.values(remaining).every((value) => value === 0 || value === false);
  impact.executedAt = new Date().toISOString();
  impact.remaining = remaining;
  impact.status = clean ? 'completed' : 'incomplete';
  fs.writeFileSync(reportPath, `${JSON.stringify(impact, null, 2)}\n`);
  console.log(JSON.stringify(impact, null, 2));
  if (!clean) {
    console.error('Deletion completed only partially; retry with --user-id and the report in temp/security-backups.');
    process.exit(1);
  }
} catch (error) {
  impact.executedAt = new Date().toISOString();
  impact.status = 'failed';
  impact.error = error instanceof Error ? error.message : String(error);
  fs.writeFileSync(reportPath, `${JSON.stringify(impact, null, 2)}\n`);
  console.error(JSON.stringify({ status: impact.status, error: impact.error, reportPath }, null, 2));
  process.exit(1);
}
