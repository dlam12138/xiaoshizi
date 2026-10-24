import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, Loader2, ShieldCheck, Trash2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { ModalFrame } from './ModalFrame';
import { supabaseService } from '../services/supabaseService';
import { GovernanceRequest, GovernanceRequestType } from '../types';

interface GovernanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: any | null;
  initialRequest?: {
    type: GovernanceRequestType;
    teacherId?: string;
    reviewId?: string;
    courseId?: string;
    offeringId?: string;
    statement?: string;
  } | null;
}

const TYPE_LABELS: Record<string, string> = {
  teacher_profile_correction: '教师资料纠错',
  course_offering_correction: '课程/授课关系纠错',
  review_report: '评价举报',
  review_withdrawal: '撤回已发布评价',
  account_deletion: '注销 / 个人数据删除申请',
};

const STATUS_LABELS: Record<string, string> = {
  submitted: '已提交',
  triaged: '已分派',
  in_review: '处理中',
  accepted: '已接受',
  rejected: '未通过',
  withdrawn: '已撤回',
  completed: '已完成',
};

export const GovernanceModal: React.FC<GovernanceModalProps> = ({
  isOpen, onClose, currentUser, initialRequest,
}) => {
  const [requests, setRequests] = useState<GovernanceRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [type, setType] = useState<GovernanceRequestType>('teacher_profile_correction');
  const [statement, setStatement] = useState('');
  const [evidence, setEvidence] = useState('');

  const fixedTarget = Boolean(initialRequest?.teacherId || initialRequest?.reviewId
    || initialRequest?.courseId || initialRequest?.offeringId);

  const load = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      setRequests(await supabaseService.getMyGovernanceRequests());
    } catch (err: any) {
      setError(err?.message || '申请记录加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSuccess(null);
    setType(initialRequest?.type || 'account_deletion');
    setStatement(initialRequest?.statement || '');
    setEvidence('');
    load();
    // The target is intentionally captured when the modal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialRequest?.type, initialRequest?.teacherId, initialRequest?.reviewId,
    initialRequest?.courseId, initialRequest?.offeringId]);

  const targetText = useMemo(() => {
    if (initialRequest?.reviewId) return `评价 ${initialRequest.reviewId.slice(0, 8)}…`;
    if (initialRequest?.courseId) return `课程 ${initialRequest.courseId.slice(0, 8)}…`;
    if (initialRequest?.teacherId) return `教师 ${initialRequest.teacherId}`;
    return '';
  }, [initialRequest]);

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!currentUser) {
      setError('请先登录后提交申请');
      return;
    }
    if (statement.trim().length < 10) {
      setError('请用至少 10 个字符说明需要处理的问题');
      return;
    }
    setSubmitting(true);
    try {
      const result = await supabaseService.submitGovernanceRequest({
        type,
        statement,
        evidenceSummary: evidence,
        targetTeacherId: initialRequest?.teacherId,
        targetReviewId: initialRequest?.reviewId,
        targetCourseId: initialRequest?.courseId,
        targetOfferingId: initialRequest?.offeringId,
      });
      if (!result.success) {
        setError(result.message || '提交失败');
        return;
      }
      setSuccess('申请已进入私有治理队列。处理结果只会在这里展示，不会公开申请说明。');
      setStatement('');
      setEvidence('');
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async (id: string) => {
    setError(null);
    const result = await supabaseService.withdrawGovernanceRequest(id);
    if (!result.success) {
      setError(result.message || '撤回失败');
      return;
    }
    await load();
  };

  return (
    <ModalFrame id="governance-modal" label="纠错、举报、撤回与注销" onClose={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.97 }}
        className="modal-panel relative z-10 bg-white w-full max-w-2xl max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="shrink-0 px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900">资料纠错 · 举报 · 撤回 · 注销</h3>
            <p className="text-xs text-gray-500 mt-0.5">申请与说明仅本人和授权处理人员可见</p>
          </div>
          <button onClick={onClose} aria-label="关闭窗口" className="p-2 rounded-full text-gray-400 hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!currentUser ? (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
              请先登录学生邮箱账号后提交申请。
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3 p-4 rounded-2xl border border-gray-200 bg-gray-50/60">
              {fixedTarget && (
                <div className="text-xs text-gray-600">
                  处理对象：<strong className="text-gray-900">{targetText}</strong>
                </div>
              )}
              {!fixedTarget && (
                <div className="p-2.5 rounded-xl bg-indigo-50 border border-indigo-100 text-2xs text-indigo-800 leading-relaxed">
                  教师资料纠错请在教师详情点击“资料纠错”；课程/授课关系纠错可在“主讲课程”或
                  “按课程 × 学期”处点击“纠错”；举报或撤回请在对应评价处操作。此处仅办理注销/个人数据删除申请。
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">申请类型</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as GovernanceRequestType)}
                  disabled={fixedTarget}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs disabled:bg-gray-100"
                >
                  {!fixedTarget ? (
                    <option value="account_deletion">注销 / 个人数据删除申请</option>
                  ) : (
                    <option value={type}>{TYPE_LABELS[type] || type}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  必要说明（10–2000 字）
                </label>
                <textarea
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  placeholder="请说明事实、需要更正的内容或举报理由。这里不是公开评论区。"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white"
                />
                <p className="text-2xs text-gray-400 mt-1">{statement.length}/2000 · 不收集学号</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  核验结论/材料说明（可选，勿上传身份证或学号）
                </label>
                <input
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  maxLength={2000}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white"
                  placeholder="例如：官方页面链接、课程表截图已线下核验"
                />
              </div>
              {type === 'account_deletion' && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-2xs text-rose-800 leading-relaxed">
                  提交后不会立即删除。授权人员会核对 Auth、资料、评价、点赞、积分、申请材料、奖励标记、
                  缓存与备份保留期限，再在受控后台执行；为防止滥用所需的最小标记会在政策期限内保留。
                </div>
              )}
              {error && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                </div>
              )}
              {success && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" /> {success}
                </div>
              )}
              <button
                type="submit"
                disabled={submitting || statement.trim().length < 10}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                提交到私有治理队列
              </button>
            </form>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
              <ShieldCheck className="w-4 h-4 text-indigo-600" /> 我的申请
            </div>
            {loading ? (
              <div className="py-6 text-center text-xs text-gray-400">正在同步...</div>
            ) : requests.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400">暂无申请记录</div>
            ) : requests.map((request) => (
              <div key={request.id} className="p-3 rounded-2xl border border-gray-100 bg-white space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-gray-900">
                    {TYPE_LABELS[request.requestType] || request.requestType}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-3xs font-bold ${
                    ['rejected', 'withdrawn'].includes(request.status)
                      ? 'bg-gray-100 text-gray-500'
                      : ['accepted', 'completed'].includes(request.status)
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-amber-100 text-amber-700'
                  }`}>
                    {STATUS_LABELS[request.status] || request.status}
                  </span>
                </div>
                <p className="text-2xs text-gray-600 whitespace-pre-wrap">{request.statement}</p>
                {request.resolution && (
                  <p className="text-2xs text-indigo-700 bg-indigo-50 rounded-lg p-2">
                    处理结论：{request.resolution}
                  </p>
                )}
                <div className="flex items-center justify-between text-3xs text-gray-400">
                  <span>{new Date(request.createdAt).toLocaleString('zh-CN')}</span>
                  {['submitted', 'triaged', 'in_review'].includes(request.status) && (
                    <button
                      onClick={() => withdraw(request.id)}
                      className="text-rose-500 hover:text-rose-700 flex items-center gap-0.5"
                    >
                      <Trash2 className="w-3 h-3" /> 撤回申请
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </ModalFrame>
  );
};
