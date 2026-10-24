import { usePagedQuery } from '../hooks/usePagedQuery';
import { isSupabaseConfigured } from '../lib/supabase';
import { Pagination, PageFeedback } from './Pagination';
import { ModalFrame } from './ModalFrame';
import React, { useState, useEffect } from 'react';
import { GovernanceRequest, Review, Teacher } from '../types';
import { 
  X, ShieldCheck, CheckCircle2, XCircle, AlertTriangle, 
  Search, Filter, Clock, Eye, Trash2, Send, Lock, UserCheck, Sparkles, MessageSquare,
  Users, UserPlus, Database, RefreshCw, Check, Copy, UserCog, FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { checkSensitiveContent } from '../utils/sensitiveFilter';
import { supabaseService } from '../services/supabaseService';
import { UPC_APP_NAME } from '../config/upc';

interface AdminAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  reviews: Review[];
  teachers: Teacher[];
  onApproveReview: (reviewId: string, authorUserId?: string) => Promise<{ success: boolean; message?: string } | void>;
  onRejectReview: (reviewId: string, reason: string) => Promise<{ success: boolean; message?: string } | void>;
  onDeleteReview: (reviewId: string) => Promise<void>;
  onRefreshReviews?: () => Promise<void> | void;
  currentUserEmail?: string;
  currentUserId?: string;
}

const formatReviewDate = (dateStr?: string) => {
  if (!dateStr || dateStr === '刚刚') return '刚刚';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const PRESET_REJECTION_REASONS = [
  '包含不当言论、粗俗用语或人身攻击',
  '涉嫌广告营销、代考代写或外部联系方式引流',
  '泄露教师或学生个人隐私（如电话、微信、住址等）',
  '评价内容与课程实际教学无关，属于无意义刷屏灌水',
  '评分模式异常或疑似重复刷分，需人工核验',
];

export const AdminAuditModal: React.FC<AdminAuditModalProps> = ({
  isOpen,
  onClose,
  reviews: initialReviews,
  teachers,
  onApproveReview,
  onRejectReview,
  onDeleteReview,
  onRefreshReviews,
  currentUserEmail,
  currentUserId,
}) => {
  // Navigation between Reviews Audit and Admin Users Config
  const [activeSection, setActiveSection] = useState<'reviews' | 'governance' | 'admins'>('reviews');

  // Access is derived only from the authenticated server response.
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [isCheckingAdmin, setIsCheckingAdmin] = useState(true);
  const [adminRole, setAdminRole] = useState<string>('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [mfaFactors, setMfaFactors] = useState<Array<{ id: string; status: string; friendly_name?: string }>>([]);
  const [mfaEnrollment, setMfaEnrollment] = useState<{ id: string; secret: string; qr: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

  // Status feedback toast
  const [toastNotice, setToastNotice] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);

  const showToast = (type: 'success' | 'error' | 'warning', text: string) => {
    setToastNotice({ type, text });
    setTimeout(() => {
      setToastNotice((prev) => (prev?.text === text ? null : prev));
    }, 5000);
  };

  // Dynamic Supabase Admin List state
  const [adminList, setAdminList] = useState<Array<{ id: string; user_id: string; role: string; nickname: string; is_active: boolean; can_investigate_identity: boolean; created_at: string }>>([]);
  const [isLoadingAdmins, setIsLoadingAdmins] = useState<boolean>(false);
  const [newAdminId, setNewAdminId] = useState('');
  const [newAdminNickname, setNewAdminNickname] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'super_admin' | 'admin' | 'moderator'>('admin');
  const [newAdminInvestigator, setNewAdminInvestigator] = useState(false);
  const [governance, setGovernance] = useState<GovernanceRequest[]>([]);
  const [isLoadingGovernance, setIsLoadingGovernance] = useState(false);
  const [governanceResolution, setGovernanceResolution] = useState<Record<string, string>>({});
  const [correctionDrafts, setCorrectionDrafts] = useState<Record<string, {
    teacherName: string;
    teacherTitle: string;
    teacherCollegeCode: string;
    teacherCampus: string;
    courseName: string;
    courseCode: string;
    courseCollegeCode: string;
    offeringAction: 'remove' | 'add';
    offeringTeacherId: string;
    offeringCourseId: string;
    offeringTermId: string;
    offeringSourceId: string;
    sourceBasis: string;
  }>>({});
  const [applyingCorrectionId, setApplyingCorrectionId] = useState<string | null>(null);
  const [adminActionMsg, setAdminActionMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedRlsSql, setCopiedRlsSql] = useState(false);
  const [isRefreshingReviews, setIsRefreshingReviews] = useState(false);

  // Moderation filtering state
  const [currentTab, setCurrentTab] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [reviewRevision, setReviewRevision] = useState(0);
  const [reviewCounts, setReviewCounts] = useState({ pending: 0, approved: 0, rejected: 0, withdrawn: 0 });
  const reviewPage = usePagedQuery<Review>(JSON.stringify([currentUserId, currentTab, searchKeyword]),
    (page, signal) => supabaseService.getAdminReviewsPage({ status: currentTab, query: searchKeyword, page }, signal),
    isSupabaseConfigured && isOpen && isAdminAuthenticated && activeSection === 'reviews', reviewRevision);
  const reviews = isSupabaseConfigured ? reviewPage.items : initialReviews;
  useEffect(() => {
    if (!isSupabaseConfigured || !isOpen || !isAdminAuthenticated) return;
    let active = true;
    supabaseService.getReviewCounts().then(counts => { if (active) setReviewCounts(counts); }).catch(() => {});
    return () => { active = false; };
  }, [isOpen, isAdminAuthenticated, reviewRevision]);

  // Reject Dialog state
  const [rejectingReview, setRejectingReview] = useState<Review | null>(null);
  const [selectedReason, setSelectedReason] = useState(PRESET_REJECTION_REASONS[0]);
  const [customReason, setCustomReason] = useState('');

  useEffect(() => {
    let active = true;
    setIsAdminAuthenticated(false);
    setIsCheckingAdmin(true);
    setAdminRole('');
    setNeedsMfa(false);
    setMfaEnrollment(null);
    setMfaCode('');
    setMfaError(null);
    setActiveSection('reviews');
    supabaseService.checkIsAdmin().then(async (res) => {
      if (!active) return;
      setIsAdminAuthenticated(res.isAdmin);
      setAdminRole(res.role || '');
      const requiresMfa = Boolean(res.isAdmin && res.mfaRequired !== false && !res.completedAal2);
      setNeedsMfa(requiresMfa);
      setIsCheckingAdmin(false);
      if (requiresMfa) {
        try {
          const factors = await supabaseService.listMfaFactors();
          if (active) setMfaFactors((factors as any)?.totp || []);
        } catch {
          if (active) setMfaFactors([]);
        }
      }
    });
    return () => { active = false; };
  }, [currentUserId, currentUserEmail]);

  // Load admin list when switching to admin config tab
  const loadAdmins = async () => {
    setIsLoadingAdmins(true);
    try {
      const list = await supabaseService.getAdminList();
      setAdminList(list);
    } catch (e) {
      console.warn('Failed to load admins:', e);
    } finally {
      setIsLoadingAdmins(false);
    }
  };

  const handleMfaEnroll = async () => {
    setMfaBusy(true);
    setMfaError(null);
    try {
      const enrolled = await supabaseService.enrollTotp();
      setMfaEnrollment({
        id: enrolled.id,
        secret: enrolled.totp.secret,
        qr: enrolled.totp.qr_code,
      });
    } catch (err: any) {
      setMfaError(err?.message || 'TOTP 绑定失败');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleMfaVerify = async () => {
    const factorId = mfaEnrollment?.id || mfaFactors.find((factor) => factor.status === 'verified')?.id;
    if (!factorId) {
      setMfaError('请先绑定 TOTP 验证器');
      return;
    }
    if (!/^\d{6}$/.test(mfaCode.trim())) {
      setMfaError('请输入 6 位动态验证码');
      return;
    }
    setMfaBusy(true);
    setMfaError(null);
    try {
      await supabaseService.verifyTotp(factorId, mfaCode);
      const res = await supabaseService.checkIsAdmin();
      if (!res.isAdmin || !res.completedAal2) {
        setMfaError('验证已提交，但 AAL2 会话未生效，请重新登录后再试');
        return;
      }
      setNeedsMfa(false);
      setMfaCode('');
      setMfaEnrollment(null);
      showToast('success', '已通过 TOTP 强验证（AAL2）');
    } catch (err: any) {
      setMfaError(err?.message || '验证码校验失败');
    } finally {
      setMfaBusy(false);
    }
  };

  const loadGovernance = async () => {
    setIsLoadingGovernance(true);
    try {
      const rows = await supabaseService.getAdminGovernanceQueue();
      setGovernance(rows);
      setCorrectionDrafts((prev) => {
        const next = { ...prev };
        for (const request of rows) {
          if (next[request.id]) continue;
          next[request.id] = {
            teacherName: request.targetTeacherName || '',
            teacherTitle: request.targetTeacherTitle || '',
            teacherCollegeCode: request.targetTeacherCollegeCode || '',
            teacherCampus: request.targetTeacherCampus || '',
            courseName: request.targetCourseName || '',
            courseCode: request.targetCourseCode || '',
            courseCollegeCode: request.targetCourseCollegeCode || '',
            offeringAction: 'remove',
            offeringTeacherId: request.targetOfferingTeacherId || request.targetTeacherId || '',
            offeringCourseId: request.targetOfferingCourseId || request.targetCourseId || '',
            offeringTermId: request.targetOfferingTermId || '',
            offeringSourceId: request.targetOfferingSourceId || '',
            sourceBasis: '',
          };
        }
        return next;
      });
    } catch (e) {
      console.warn('Failed to load governance queue:', e);
    } finally {
      setIsLoadingGovernance(false);
    }
  };

  useEffect(() => {
    if (activeSection === 'admins' && isAdminAuthenticated && adminRole === 'super_admin') {
      loadAdmins();
    }
    if (activeSection === 'governance' && isAdminAuthenticated) {
      loadGovernance();
    }
  }, [activeSection, isAdminAuthenticated, adminRole]);

  // Add new admin handler
  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(newAdminId.trim())) {
      setAdminActionMsg({ text: '请输入目标账号稳定的 Auth 用户 UUID', isError: true });
      return;
    }

    setAdminActionMsg(null);
    const result = await supabaseService.setAdminRole(
      newAdminId.trim(),
      newAdminRole,
      newAdminNickname.trim() || '反馈审核员',
      newAdminInvestigator,
    );

    if (result.success) {
      setAdminActionMsg({ text: '管理员角色已绑定到该 Auth 用户。' });
      setNewAdminId('');
      setNewAdminNickname('');
      loadAdmins();
    } else {
      setAdminActionMsg({ text: result.message || '保存失败，请确认目标账号已验证。', isError: true });
    }
  };

  // Toggle admin active status by immutable Auth subject.
  const handleToggleAdminStatus = async (userId: string, currentStatus: boolean) => {
    const success = await supabaseService.toggleAdminStatus(userId, !currentStatus);
    if (success) {
      loadAdmins();
    }
  };

  const isCorrectionRequest = (request: GovernanceRequest) =>
    request.requestType === 'teacher_profile_correction'
    || request.requestType === 'course_offering_correction';

  const updateCorrectionDraft = (requestId: string, patch: Partial<typeof correctionDrafts[string]>) => {
    setCorrectionDrafts((prev) => ({
      ...prev,
      [requestId]: { ...prev[requestId], ...patch },
    }));
  };

  const handleApplyCorrection = async (request: GovernanceRequest) => {
    const draft = correctionDrafts[request.id];
    if (!draft) return;
    const sourceBasis = draft.sourceBasis.trim();
    if (sourceBasis.length < 10) {
      showToast('error', '请填写至少 10 个字的来源依据');
      return;
    }
    let patch: Record<string, unknown>;
    if (request.requestType === 'teacher_profile_correction') {
      patch = {
        teacher: {
          id: request.targetTeacherId,
          name: draft.teacherName.trim(),
          title: draft.teacherTitle.trim() || null,
          collegeCode: draft.teacherCollegeCode.trim(),
          campus: draft.teacherCampus.trim() || null,
        },
      };
    } else if (request.targetOfferingId) {
      patch = {
        offering: draft.offeringAction === 'remove'
          ? { action: 'remove', offeringId: request.targetOfferingId }
          : {
            action: 'add',
            teacherId: draft.offeringTeacherId.trim(),
            courseId: draft.offeringCourseId.trim(),
            termId: draft.offeringTermId.trim(),
            sourceId: draft.offeringSourceId.trim() || null,
          },
      };
    } else {
      patch = {
        course: {
          id: request.targetCourseId,
          name: draft.courseName.trim(),
          code: draft.courseCode.trim() || null,
          collegeCode: draft.courseCollegeCode.trim(),
        },
      };
    }

    setApplyingCorrectionId(request.id);
    try {
      const result = await supabaseService.applyGovernanceCorrection(request.id, patch, sourceBasis);
      if (!result.success) {
        showToast('error', result.message || '资料纠正写回失败');
        return;
      }
      showToast('success', `资料已写回并完成：${(result.changedFields || []).join('、') || '已记录'}`);
      await loadGovernance();
    } finally {
      setApplyingCorrectionId(null);
    }
  };

  const handleGovernanceProcess = async (request: GovernanceRequest, status: GovernanceRequest['status']) => {
    const resolution = (governanceResolution[request.id] || '').trim();
    if (['accepted', 'rejected', 'completed'].includes(status) && resolution.length < 2) {
      showToast('error', '接受、驳回或完成时必须填写处理结论');
      return;
    }
    const result = await supabaseService.processGovernanceRequest(request.id, status, resolution);
    if (!result.success) {
      showToast('error', result.message || '处理失败');
      return;
    }
    showToast('success', '治理申请状态已更新');
    loadGovernance();
  };

  const copyMigrationInstructions = async (kind: 'schema' | 'rls') => {
    // SQL is versioned in the repository; never distribute alternate, weaker policies.
    await navigator.clipboard.writeText('请按 docs/upc-database.md 和 supabase/upc-init.sql 的完整顺序初始化独立 UPC 项目；不要在已有业务库上重复执行建表片段，也不要使用旧校迁移或快捷修复 SQL。');
    if (kind === 'schema') setCopiedSql(true); else setCopiedRlsSql(true);
    setTimeout(() => { setCopiedSql(false); setCopiedRlsSql(false); }, 2000);
  };
  const copySqlCode = () => copyMigrationInstructions('schema');
  const copyRlsSqlCode = () => copyMigrationInstructions('rls');

  const handleManualRefresh = async () => {
    setIsRefreshingReviews(true);
    try {
      if (onRefreshReviews) {
        await onRefreshReviews();
      }
    } finally {
      setIsRefreshingReviews(false);
      setReviewRevision(value => value + 1);
    }
  };

  // Automatically refresh reviews whenever admin opens the modal
  useEffect(() => {
    if (isOpen && onRefreshReviews) {
      onRefreshReviews();
    }
  }, [isOpen]);

  // Status counts
  const pendingCount = isSupabaseConfigured ? reviewCounts.pending : reviews.filter((r) => r.status === 'pending').length;
  const approvedCount = isSupabaseConfigured ? reviewCounts.approved : reviews.filter((r) => r.status === 'approved').length;
  const rejectedCount = isSupabaseConfigured ? reviewCounts.rejected : reviews.filter((r) => r.status === 'rejected').length;
  const withdrawnCount = isSupabaseConfigured ? reviewCounts.withdrawn : reviews.filter((r) => r.status === 'withdrawn').length;

  // Filter reviews
  const filteredReviews = isSupabaseConfigured ? reviews : reviews.filter((r) => {
    // 1. Tab filter
    if (currentTab !== 'all' && r.status !== currentTab) return false;

    // 2. Search keyword filter
    if (!searchKeyword.trim()) return true;
    const kw = searchKeyword.toLowerCase();
    const teacher = teachers.find((t) => t.id === r.teacherId) || { name: r.teacherName };
    return (
      (teacher?.name && teacher.name.toLowerCase().includes(kw)) ||
      (r.courseName && r.courseName.toLowerCase().includes(kw)) ||
      (r.comment && r.comment.toLowerCase().includes(kw)) ||
      (r.authorNickname && r.authorNickname.toLowerCase().includes(kw))
    );
  });

  const handleApprove = async (review: Review) => {
    setProcessingId(review.id);
    try {
      const res = await onApproveReview(review.id, review.userId);
      if (res && !res.success) {
        showToast('error', `审核通过本地已生效，但云端同步受阻：${res.message || '权限校验未通过'}`);
      } else {
        showToast('success', '【审核通过】评价已成功通过公示！作者已获 +20 积分奖励');
      }
    } catch (err: any) {
      showToast('error', `审核异常: ${err?.message || '未知错误'}`);
    } finally {
      setProcessingId(null);
      setReviewRevision(value => value + 1);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingReview) return;
    const reason = customReason.trim() ? customReason.trim() : selectedReason;
    setProcessingId(rejectingReview.id);
    try {
      const res = await onRejectReview(rejectingReview.id, reason);
      setRejectingReview(null);
      setCustomReason('');
      if (res && !res.success) {
        showToast('error', `本地已标记驳回，但云端未同步：${res.message || '权限校验未通过'}`);
      } else {
        showToast('warning', `【已驳回】评价已转入驳回归档（理由：${reason}）`);
      }
    } catch (err: any) {
      showToast('error', `驳回异常: ${err?.message || '未知错误'}`);
    } finally {
      setProcessingId(null);
      setReviewRevision(value => value + 1);
    }
  };

  if (!isOpen) return null;
  return (
    <ModalFrame id="admin-modal" label="管理员工作台" onClose={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="modal-panel relative bg-white w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-gray-100"
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 bg-slate-900 text-white grid grid-cols-[minmax(0,1fr)_44px] gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-400/30 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold tracking-tight text-white">
                  {UPC_APP_NAME} · 管理工作台
                </h3>
                <span className="px-2 py-0.5 rounded-full text-3xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {adminRole === 'super_admin' ? '超管权限' : '审核权限'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                严格把关反馈内容 · 动态管理审核团队名单 (Supabase 数据库驱动)
              </p>
            </div>
          </div>

          <button
            onClick={onClose} data-modal-close aria-label="关闭窗口"
            className="self-start rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
            {isAdminAuthenticated && (
              <div className="col-span-2 flex flex-wrap items-center bg-slate-800 p-1 rounded-xl border border-slate-700">
                <button
                  onClick={() => setActiveSection('reviews')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeSection === 'reviews'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>反馈审核</span>
                  {pendingCount > 0 && (
                    <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 rounded-full text-4xs font-black">
                      {pendingCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveSection('governance')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeSection === 'governance'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>纠错与举报</span>
                  {governance.filter((g) => !['completed', 'rejected', 'withdrawn'].includes(g.status)).length > 0 && (
                    <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 rounded-full text-4xs font-black">
                      {governance.filter((g) => !['completed', 'rejected', 'withdrawn'].includes(g.status)).length}
                    </span>
                  )}
                </button>
                <button
                  disabled={adminRole !== 'super_admin'}
                  title={adminRole === 'super_admin' ? '管理审核团队' : '仅超级管理员可管理名单'}
                  onClick={() => setActiveSection('admins')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeSection === 'admins'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>管理员动态配置</span>
                </button>
              </div>
            )}
        </div>

        {/* Action Toast Alert Banner */}
        {toastNotice && (
          <div className="px-6 pt-3">
            <div
              className={`p-3 rounded-2xl border text-xs font-semibold flex items-center justify-between shadow-2xs transition-all ${
                toastNotice.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : toastNotice.type === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <div className="flex items-center gap-2">
                {toastNotice.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : toastNotice.type === 'error' ? (
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                ) : (
                  <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                )}
                <span>{toastNotice.text}</span>
              </div>
              <button
                onClick={() => setToastNotice(null)}
                className="text-gray-400 hover:text-gray-700 text-xs ml-3 px-1.5 py-0.5 rounded hover:bg-black/5 cursor-pointer font-bold"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Content Body */}
        {!isAdminAuthenticated ? (
          /* Admin Login Gate */
          <div className="flex-1 overflow-y-auto p-8 sm:p-12 text-center space-y-5">
            <div className="w-16 h-16 rounded-3xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100 shadow-xs">
              <Lock className="w-8 h-8" />
            </div>
            <div className="max-w-md space-y-1.5">
              <h4 className="text-lg font-bold text-gray-900">需要管理员身份验证</h4>
              <p className="text-xs text-gray-500 leading-relaxed">
                当前登录邮箱：<strong>{currentUserEmail || '未登录/普通学生'}</strong>
                <br />
                {isCheckingAdmin ? '正在核验管理员权限…' : '当前账号未获得有效管理员授权，请联系超级管理员。'}
              </p>
            </div>

          </div>
        ) : needsMfa ? (
          <div className="flex-1 overflow-y-auto p-6 sm:p-10 bg-slate-50">
            <div className="max-w-md mx-auto bg-white rounded-3xl border border-gray-200 p-6 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-base font-bold text-gray-900">管理员强验证（AAL2）</h4>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  管理员敏感操作需要 TOTP 动态验证码。未完成强验证的会话不能读取私有审核队列或执行审核。
                </p>
              </div>
              {mfaError && <div className="p-2.5 rounded-xl bg-rose-50 text-rose-700 text-xs">{mfaError}</div>}
              {!mfaEnrollment && mfaFactors.some((factor) => factor.status === 'verified') ? (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-gray-700">输入验证器中的 6 位动态码</label>
                  <input
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-mono tracking-[0.3em] text-center"
                    placeholder="000000"
                  />
                </div>
              ) : mfaEnrollment ? (
                <div className="space-y-3 text-xs">
                  <p className="text-gray-600">用验证器扫描二维码，或手动输入密钥，然后填写 6 位动态码。</p>
                  <img src={mfaEnrollment.qr} alt="TOTP 绑定二维码" className="w-40 h-40 mx-auto rounded-xl border" />
                  <div className="p-2.5 rounded-xl bg-gray-50 font-mono text-2xs break-all">{mfaEnrollment.secret}</div>
                  <input
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 font-mono tracking-[0.3em] text-center"
                    placeholder="000000"
                  />
                </div>
              ) : (
                <button
                  onClick={handleMfaEnroll}
                  disabled={mfaBusy}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold disabled:opacity-50"
                >
                  {mfaBusy ? '正在创建 TOTP...' : '绑定 TOTP 验证器'}
                </button>
              )}
              {(mfaEnrollment || mfaFactors.some((factor) => factor.status === 'verified')) && (
                <button
                  onClick={handleMfaVerify}
                  disabled={mfaBusy || mfaCode.length !== 6}
                  className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-50"
                >
                  {mfaBusy ? '验证中...' : '完成强验证并进入后台'}
                </button>
              )}
            </div>
          </div>
        ) : activeSection === 'governance' ? (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-gray-900">私有治理队列</h4>
                <p className="text-2xs text-gray-500 mt-0.5">教师/课程纠错、举报、撤回、注销申请。申请文字不公开。</p>
              </div>
              <button onClick={loadGovernance} disabled={isLoadingGovernance} className="px-3 py-1.5 rounded-xl bg-white border border-gray-200 text-xs font-bold text-indigo-700 flex items-center gap-1">
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGovernance ? 'animate-spin' : ''}`} /> 刷新
              </button>
            </div>
            {governance.length === 0 ? (
              <div className="py-10 text-center text-xs text-gray-400">暂无治理申请</div>
            ) : governance.map((request) => {
              const draft = correctionDrafts[request.id];
              const canWriteBack = isCorrectionRequest(request)
                && !['completed', 'rejected', 'withdrawn'].includes(request.status);
              return (
                <div key={request.id} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold text-gray-900">
                      {request.requestType} · {request.targetTeacherName || request.targetCourseName || request.targetReviewId || '账户申请'}
                    </div>
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-3xs font-bold">
                      {request.status}
                    </span>
                  </div>
                  <p className="text-2xs text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-xl p-2.5">{request.statement}</p>
                  {request.evidenceSummary && <p className="text-3xs text-gray-500">材料说明：{request.evidenceSummary}</p>}

                  {canWriteBack && draft && (
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 space-y-2">
                      <div className="text-2xs font-bold text-indigo-800">
                        实际写回资料（不会仅修改申请状态）
                      </div>
                      {request.requestType === 'teacher_profile_correction' ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            value={draft.teacherName}
                            onChange={(e) => updateCorrectionDraft(request.id, { teacherName: e.target.value })}
                            placeholder="教师姓名"
                            className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs"
                          />
                          <input
                            value={draft.teacherTitle}
                            onChange={(e) => updateCorrectionDraft(request.id, { teacherTitle: e.target.value })}
                            placeholder="职称（可留空清除）"
                            className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs"
                          />
                          <input
                            value={draft.teacherCollegeCode}
                            onChange={(e) => updateCorrectionDraft(request.id, { teacherCollegeCode: e.target.value })}
                            placeholder="学院编码，例如 upc-12"
                            className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs"
                          />
                          <input
                            value={draft.teacherCampus}
                            onChange={(e) => updateCorrectionDraft(request.id, { teacherCampus: e.target.value })}
                            placeholder="校区（可留空清除）"
                            className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs"
                          />
                        </div>
                      ) : request.targetOfferingId ? (
                        <div className="space-y-2">
                          <select
                            value={draft.offeringAction}
                            onChange={(e) => updateCorrectionDraft(request.id, {
                              offeringAction: e.target.value as 'remove' | 'add',
                            })}
                            className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs bg-white"
                          >
                            <option value="remove">删除误录授课关系</option>
                            <option value="add">新增缺失授课关系</option>
                          </select>
                          {draft.offeringAction === 'remove' ? (
                            <p className="text-3xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                              删除前会检查评价与公开统计引用；存在引用时整笔拒绝，不自动删除或转移评价。
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <input
                                value={draft.offeringTeacherId}
                                onChange={(e) => updateCorrectionDraft(request.id, { offeringTeacherId: e.target.value })}
                                placeholder="教师 ID，例如 upc:..."
                                className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs"
                              />
                              <input
                                value={draft.offeringCourseId}
                                onChange={(e) => updateCorrectionDraft(request.id, { offeringCourseId: e.target.value })}
                                placeholder="课程 UUID"
                                className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs"
                              />
                              <input
                                value={draft.offeringTermId}
                                onChange={(e) => updateCorrectionDraft(request.id, { offeringTermId: e.target.value })}
                                placeholder="学期 UUID"
                                className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs"
                              />
                              <input
                                value={draft.offeringSourceId}
                                onChange={(e) => updateCorrectionDraft(request.id, { offeringSourceId: e.target.value })}
                                placeholder="来源标识（可选）"
                                className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs"
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            value={draft.courseName}
                            onChange={(e) => updateCorrectionDraft(request.id, { courseName: e.target.value })}
                            placeholder="课程名称"
                            className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs"
                          />
                          <input
                            value={draft.courseCode}
                            onChange={(e) => updateCorrectionDraft(request.id, { courseCode: e.target.value })}
                            placeholder="课程编码（可留空清除）"
                            className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs"
                          />
                          <input
                            value={draft.courseCollegeCode}
                            onChange={(e) => updateCorrectionDraft(request.id, { courseCollegeCode: e.target.value })}
                            placeholder="开课学院编码"
                            className="px-3 py-1.5 rounded-xl border border-gray-200 text-xs sm:col-span-2"
                          />
                        </div>
                      )}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          value={draft.sourceBasis}
                          onChange={(e) => updateCorrectionDraft(request.id, { sourceBasis: e.target.value })}
                          placeholder="来源依据（至少 10 字，例如教务处页面已核对）"
                          className="flex-1 px-3 py-1.5 rounded-xl border border-gray-200 text-xs"
                        />
                        <button
                          onClick={() => handleApplyCorrection(request)}
                          disabled={applyingCorrectionId === request.id}
                          className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-1"
                        >
                          {applyingCorrectionId === request.id && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                          写回并完成
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <input
                      value={governanceResolution[request.id] || ''}
                      onChange={(e) => setGovernanceResolution((prev) => ({ ...prev, [request.id]: e.target.value }))}
                      placeholder="处理结论（驳回时必填）"
                      className="flex-1 px-3 py-1.5 rounded-xl border border-gray-200 text-xs"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {(isCorrectionRequest(request)
                        ? ['triaged', 'in_review', 'rejected']
                        : ['triaged', 'in_review', 'accepted', 'rejected', 'completed']
                      ).map((status) => (
                        <button
                          key={status}
                          onClick={() => handleGovernanceProcess(request, status as GovernanceRequest['status'])}
                          className="px-2.5 py-1 rounded-lg border border-gray-200 text-3xs font-semibold hover:bg-indigo-50 hover:text-indigo-700"
                        >
                          {status}
                        </button>
                      ))}
                    </div>
                  </div>
                  {request.resolution && <p className="text-3xs text-emerald-700">结论：{request.resolution}</p>}
                </div>
              );
            })}
          </div>
        ) : activeSection === 'admins' && adminRole === 'super_admin' ? (
          /* Dynamic Admin Database Management Workspace */
          <div className="flex-1 flex flex-col overflow-y-auto p-6 bg-slate-50 space-y-6">
            {/* Supabase Status Banner */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                  <Database className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-gray-900">Supabase 动态管理员配置表 (public.admin_users)</h4>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-3xs font-bold">
                      云端同步已连接
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    管理员权限绑定不可变 Auth 用户 UUID；邮箱仅用于登录和联系，不再是授权键。变更或停用立即影响服务端授权。
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  onClick={copySqlCode}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                  title="复制数据库升级说明"
                >
                  {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedSql ? '已复制' : '复制迁移说明'}</span>
                </button>
                <button
                  onClick={loadAdmins}
                  disabled={isLoadingAdmins}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAdmins ? 'animate-spin' : ''}`} />
                  <span>刷新列表</span>
                </button>
              </div>
            </div>

            {/* Add New Admin Form */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-2xs space-y-4">
              <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                <UserPlus className="w-4 h-4 text-indigo-600" />
                <span>新增管理员账号</span>
              </div>

              {adminActionMsg && (
                <div className={`p-3 rounded-xl text-xs font-medium ${
                  adminActionMsg.isError ? 'bg-rose-50 text-rose-700 border border-rose-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                }`}>
                  {adminActionMsg.text}
                </div>
              )}

              <form onSubmit={handleAddAdmin} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-5 space-y-1">
                  <label className="text-xs font-semibold text-gray-700">管理员 Auth 用户 UUID（稳定主体）</label>
                  <input
                    type="text"
                    required
                    placeholder="已验证账号的 UUID，不使用可变邮箱授权"
                    value={newAdminId}
                    onChange={(e) => setNewAdminId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-indigo-600 bg-gray-50 focus:bg-white font-mono"
                  />
                </div>

                <div className="sm:col-span-3 space-y-1">
                  <label className="text-xs font-semibold text-gray-700">审核员备注昵称</label>
                  <input
                    type="text"
                    placeholder="如: 学工处李老师 / 反馈审核组长"
                    value={newAdminNickname}
                    onChange={(e) => setNewAdminNickname(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-indigo-600 bg-gray-50 focus:bg-white"
                  />
                </div>

                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-semibold text-gray-700">权限角色</label>
                  <select
                    value={newAdminRole}
                    onChange={(e) => setNewAdminRole(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-indigo-600 bg-gray-50 focus:bg-white"
                  >
                    <option value="admin">审核管理员 (admin)</option>
                    <option value="super_admin">站长超管 (super_admin)</option>
                    <option value="moderator">助理审核员 (moderator)</option>
                  </select>
                  <label className="flex items-center gap-1 text-3xs text-gray-500 mt-1">
                    <input type="checkbox" checked={newAdminInvestigator} onChange={(e) => setNewAdminInvestigator(e.target.checked)} />
                    允许敏感身份调查
                  </label>
                </div>

                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>添加授权</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Current Admin Table */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-2xs overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-bold text-gray-900">当前已配置的管理员团队</span>
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold">
                    {adminList.length} 位
                  </span>
                </div>
              </div>

              <div className="divide-y divide-gray-100">
                {adminList.length === 0 ? (
                  <div className="p-8 text-center text-xs text-gray-400">
                    暂未查询到管理员记录，请确认账号拥有超级管理员权限。
                  </div>
                ) : (
                  adminList.map((adm) => (
                    <div key={adm.id || adm.user_id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50/60 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold text-xs">
                          {adm.nickname?.slice(0, 1) || '管'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-900">{adm.nickname}</span>
                            <span className="text-3xs text-gray-400 font-mono">{adm.user_id.slice(0, 8)}…</span>
                            {adm.role === 'super_admin' ? (
                              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md text-3xs font-bold">
                                👑 站长超管
                              </span>
                            ) : adm.role === 'moderator' ? (
                              <span className="px-2 py-0.5 bg-sky-100 text-sky-800 rounded-md text-3xs font-bold">
                                助理协管
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-md text-3xs font-bold">
                                审核管理员
                              </span>
                            )}
                            {adm.is_active ? (
                              <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-700 rounded text-3xs font-medium">
                                活跃有效
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 bg-gray-100 text-gray-500 rounded text-3xs font-medium">
                                已停用
                              </span>
                            )}
                          </div>
                          <p className="text-2xs text-gray-500 mt-0.5">
                            登记时间：{new Date(adm.created_at || Date.now()).toLocaleDateString()}
                            {adm.can_investigate_identity ? ' · 可调查身份' : ''}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <button
                          onClick={() => handleToggleAdminStatus(adm.user_id, adm.is_active)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                            adm.is_active 
                              ? 'bg-gray-100 hover:bg-rose-50 hover:text-rose-600 text-gray-600'
                              : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {adm.is_active ? '停用权限' : '恢复启用'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Supabase SQL Instructions Card */}
            <div className="bg-slate-900 text-slate-200 p-5 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-400" />
                  <span className="text-xs font-bold text-white">Supabase 后台快速操作指南</span>
                </div>
                <button
                  onClick={copySqlCode}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedSql ? '已复制' : '复制迁移说明'}</span>
                </button>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                请由项目维护者按照仓库中的数据库迁移说明完成配置；仅超级管理员可以新增或停用管理员。
              </p>


            </div>
          </div>
        ) : (
          /* Moderation Workspace */
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50">
            {/* Top Toolbar */}
            <div className="shrink-0 p-4 bg-white border-b border-gray-100 flex flex-col sm:flex-row gap-3 items-center justify-between">
              {/* Tab Pills */}
              <div className="flex items-center gap-1.5 p-1 bg-gray-100/80 rounded-2xl w-full sm:w-auto overflow-x-auto [&>button]:shrink-0 [&>button]:whitespace-nowrap">
                <button
                  onClick={() => setCurrentTab('pending')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    currentTab === 'pending'
                      ? 'bg-white text-amber-600 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5 text-amber-500" />
                  <span>待审核</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-700 text-3xs font-bold">
                    {pendingCount}
                  </span>
                </button>

                <button
                  onClick={() => setCurrentTab('approved')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    currentTab === 'approved'
                      ? 'bg-white text-emerald-600 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>已公示</span>
                  <span className="text-3xs text-gray-400">({approvedCount})</span>
                </button>

                <button
                  onClick={() => setCurrentTab('rejected')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                    currentTab === 'rejected'
                      ? 'bg-white text-rose-600 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <XCircle className="w-3.5 h-3.5 text-rose-500" />
                  <span>已驳回</span>
                  <span className="text-3xs text-gray-400">({rejectedCount})</span>
                </button>

                <button
                  onClick={() => setCurrentTab('all')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    currentTab === 'all'
                      ? 'bg-white text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  全部 ({pendingCount + approvedCount + rejectedCount})
                </button>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={handleManualRefresh}
                  disabled={isRefreshingReviews}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold transition-all shrink-0 disabled:opacity-50"
                  title="重新从 Supabase 云端拉取最新反馈与待审数据"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingReviews ? 'animate-spin text-indigo-600' : ''}`} />
                  <span>刷新数据</span>
                </button>

                {/* Search Bar */}
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="搜索教师、课程或内容..."
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-indigo-600 bg-gray-50 focus:bg-white transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Reviews List */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              <PageFeedback loading={reviewPage.loading} error={reviewPage.error} onRetry={reviewPage.reload} />
              {isSupabaseConfigured && <Pagination page={reviewPage.page} total={reviewPage.total} loading={reviewPage.loading} onPageChange={reviewPage.setPage} />}
              {reviewPage.loading || reviewPage.error ? null : filteredReviews.length === 0 ? (
                <div className="py-12 px-4 text-center space-y-4 max-w-lg mx-auto">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h5 className="text-sm font-bold text-gray-800">
                      {currentTab === 'pending' ? '当前暂无待审核反馈' : '暂无匹配的评价记录'}
                    </h5>
                    <p className="text-xs text-gray-400 mt-1">
                      {currentTab === 'pending'
                        ? '当有学子提交新的课堂反馈时，系统将汇总至此供您审批公示。'
                        : '您可以通过上方筛选查看其他状态分类。'}
                    </p>
                  </div>

                  {currentTab === 'pending' && (
                    <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-2xl text-left space-y-2.5">
                      <div className="flex items-start gap-2 text-amber-900">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="text-xs font-semibold">
                          若其他账号已提交评价却在此处看不到？
                        </div>
                      </div>
                      <p className="text-2xs text-amber-800 leading-relaxed">
                        请确认账号已获授权、网络正常且数据库迁移已完成；空列表也可能表示目前没有待审评价。
                      </p>
                      <button
                        onClick={copyRlsSqlCode}
                        className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-2xs"
                      >
                        {copiedRlsSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedRlsSql ? '已复制迁移说明' : '复制数据库迁移说明'}</span>
                      </button>

                    </div>
                  )}
                </div>
              ) : (
                filteredReviews.map((rev) => {
                  const teacher = teachers.find((t) => t.id === rev.teacherId) || { name: rev.teacherName, college: '' };
                  const isProcessing = processingId === rev.id;
                  
                  // Check automated sensitive content scan
                  const sensitiveScan = checkSensitiveContent(rev.comment || '');

                  return (
                    <div
                      key={rev.id}
                      className="bg-white rounded-2xl p-5 border border-gray-100 shadow-2xs hover:shadow-xs transition-all space-y-3.5"
                    >
                      {/* Card Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-gray-50">
                        <div className="flex items-center gap-2.5">
                          <span className="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 font-bold text-xs">
                            {teacher?.name || '任课教师'}
                          </span>
                          <span className="text-gray-300">·</span>
                          <span className="text-xs font-semibold text-gray-800">
                            {rev.courseName}
                          </span>
                          <span className="text-2xs text-gray-400">
                            ({rev.yearTerm})
                          </span>
                        </div>

                        {/* Status Badge */}
                        <div className="flex items-center gap-2">
                          {rev.status === 'pending' && (
                            <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-amber-600 animate-pulse" /> ⏳ 待审核
                            </span>
                          )}
                          {rev.status === 'approved' && (
                            <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" /> ✓ 已公示 (+20分)
                            </span>
                          )}
                          {rev.status === 'rejected' && (
                            <span className="px-2.5 py-0.5 rounded-full text-2xs font-bold bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                              <XCircle className="w-3 h-3 text-rose-600" /> ✕ 已驳回
                            </span>
                          )}
                          <span className="text-3xs text-gray-400">
                            {formatReviewDate(rev.createdAt)}
                          </span>
                        </div>
                      </div>

                      {/* Dimension Scores */}
                      <div className="flex flex-wrap gap-2 text-2xs text-gray-600 bg-gray-50/80 p-2.5 rounded-xl">
                        <span className="px-2 py-0.5 bg-white rounded-md border border-gray-100">
                          给分宽松：<strong className="text-emerald-600">{rev.dimensions.gradingLeniency ?? '-'}分</strong>
                        </span>
                        <span className="px-2 py-0.5 bg-white rounded-md border border-gray-100">
                          考勤宽松度：<strong className="text-amber-600">{rev.dimensions.attendanceStrictness ?? '-'}分</strong>
                        </span>
                        <span className="px-2 py-0.5 bg-white rounded-md border border-gray-100">
                          教学质量：<strong className="text-indigo-600">{rev.dimensions.teachingQuality ?? '-'}分</strong>
                        </span>
                        <span className="px-2 py-0.5 bg-white rounded-md border border-gray-100">
                          作业轻松度：<strong className="text-purple-600">{rev.dimensions.workloadDifficulty ?? '-'}分</strong>
                        </span>
                      </div>

                      {/* Review Comment Content */}
                      <div className="space-y-2">
                        {rev.comment ? (
                          <div className="p-3 bg-slate-50/80 rounded-xl border border-slate-100 text-xs text-gray-800 leading-relaxed font-sans">
                            “{rev.comment}”
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 italic">（该学生仅提交了六维客观评分，未填写文本评价）</div>
                        )}

                        {(rev.riskFlags?.length || rev.riskReason) && (
                          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                            <strong>风控待审：</strong>{rev.riskReason || rev.riskFlags?.join('、')}
                          </div>
                        )}

                        {/* Automated Sensitive Scan Alert */}
                        {!sensitiveScan.isClean && (
                          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <div>
                              <strong className="font-semibold">前置安全扫描预警：</strong>
                              {sensitiveScan.reason}
                              <div className="mt-1 flex flex-wrap gap-1">
                                {sensitiveScan.violations.map((v, i) => (
                                  <span key={i} className="px-1.5 py-0.2 bg-amber-200/70 text-amber-900 rounded text-3xs font-mono">
                                    {v}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Rejection Reason display if rejected */}
                        {rev.status === 'rejected' && rev.rejectionReason && (
                          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-100 text-xs text-rose-700 flex items-start gap-2">
                            <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                            <div>
                              <strong className="font-bold">驳回原因：</strong>
                              {rev.rejectionReason}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Author & Action Bar */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                        <div className="text-2xs text-gray-500 flex items-center gap-2">
                          <span>公开署名：<strong>匿名石大学子</strong></span>
                          <span className="text-gray-300">·</span>
                          <span>审核队列不展示评价者邮箱/账户 ID</span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 self-end sm:self-auto">
                          {rev.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleApprove(rev)}
                                disabled={isProcessing}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {isProcessing ? '处理中...' : '【通过公示】(+20分)'}
                              </button>

                              <button
                                onClick={() => {
                                  setRejectingReview(rev);
                                  setSelectedReason(PRESET_REJECTION_REASONS[0]);
                                  setCustomReason('');
                                }}
                                disabled={isProcessing}
                                className="px-3 py-1.5 bg-white hover:bg-rose-50 active:scale-95 text-rose-600 border border-rose-200 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                【驳回修改】
                              </button>
                            </>
                          )}

                          {rev.status === 'approved' && (
                            <button
                              onClick={() => {
                                setRejectingReview(rev);
                                setSelectedReason(PRESET_REJECTION_REASONS[0]);
                                setCustomReason('');
                              }}
                              disabled={isProcessing}
                              className="px-2.5 py-1 text-xs text-gray-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            >
                              撤回并驳回
                            </button>
                          )}

                          {rev.status === 'rejected' && (
                            <button
                              onClick={() => handleApprove(rev)}
                              disabled={isProcessing}
                              className="px-2.5 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors font-semibold"
                            >
                              重新通过
                            </button>
                          )}

                          {/* Delete */}
                          <button
                            onClick={async () => {
                              const reason = prompt('删除原因（写入不可变审计日志）', '管理员删除违规评价');
                              if (reason !== null) {
                                const result = await supabaseService.deleteReviewAsAdmin(rev.id, reason || '管理员删除违规评价');
                                if (!result.success) {
                                  showToast('error', result.message || '删除失败');
                                } else {
                                  showToast('success', '评价已删除，审计日志已记录');
                                }
                                setReviewRevision(value => value + 1);
                              }
                            }}
                            className="p-1.5 text-gray-400 hover:text-rose-600 rounded-lg hover:bg-gray-100 transition-colors"
                            title="彻底删除此记录"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="shrink-0 px-4 sm:px-6 py-3 bg-gray-50 border-t border-gray-100 text-2xs text-gray-500 flex items-center justify-between">
          <span>
            {isAdminAuthenticated ? '✓ 已通过管理员权限认证' : '未授权状态'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1 text-xs text-gray-600 hover:text-gray-900 font-medium"
          >
            关闭窗口
          </button>
        </div>
      </motion.div>

      {/* Reject Reason Modal */}
      <AnimatePresence>
        {rejectingReview && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-gray-100 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-600">
                  <XCircle className="w-5 h-5" />
                  <h4 className="font-bold text-sm text-gray-900">驳回此条评价</h4>
                </div>
                <button
                  onClick={() => setRejectingReview(null)}
                  className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-gray-500">
                请选择或填写驳回原因，该原因将实时反馈在作者的“个人中心 - 我的评价”中，并允许作者重新修改后提交：
              </p>

              {/* Preset Reason Options */}
              <div className="space-y-2">
                {PRESET_REJECTION_REASONS.map((reason, idx) => (
                  <label
                    key={idx}
                    className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                      selectedReason === reason && !customReason
                        ? 'bg-rose-50/80 border-rose-200 text-rose-900 font-medium'
                        : 'bg-white border-gray-100 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="rejection_reason"
                      checked={selectedReason === reason && !customReason}
                      onChange={() => {
                        setSelectedReason(reason);
                        setCustomReason('');
                      }}
                      className="mt-0.5 text-rose-600 focus:ring-rose-500"
                    />
                    <span>{reason}</span>
                  </label>
                ))}
              </div>

              {/* Custom Input */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-700">其他自定义理由：</label>
                <textarea
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="如：请补充期末考核占比与平时作业量等关键细节..."
                  rows={2}
                  className="w-full p-2.5 text-xs rounded-xl border border-gray-200 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-200"
                />
              </div>

              {/* Confirm Actions */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setRejectingReview(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleConfirmReject}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-all shadow-xs"
                >
                  确认驳回通知作者
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ModalFrame>
  );
};
