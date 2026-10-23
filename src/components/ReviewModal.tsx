import { ModalFrame } from './ModalFrame';
import {
  NEW_RATING_HINT, RATING_DIMENSIONS, formatNewRatingInput,
  parseNewRatingInput, validateNewRatingDimensions, validateNewRatingInput,
} from '../lib/ratings';
import React, { useState, useEffect, useMemo } from 'react';
import { Teacher, Review, Term } from '../types';
import { X, ShieldCheck, AlertTriangle, EyeOff, User } from 'lucide-react';
import { motion } from 'motion/react';
import { AnimatedDropdown } from './AnimatedDropdown';
import { supabaseService } from '../services/supabaseService';
import { useTeacherSearch } from '../hooks/useTeacherSearch';
import { PageFeedback } from './Pagination';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  teachers: Teacher[];
  preselectedTeacher?: Teacher | null;
  currentUser?: any | null;
  onSubmitReview: (review: Omit<Review, 'id' | 'createdAt' | 'likes'>) => Promise<{ success: boolean; message?: string }> | void;
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  isOpen,
  onClose,
  teachers,
  preselectedTeacher,
  currentUser,
  onSubmitReview,
}) => {
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(
    preselectedTeacher?.id || ''
  );
  const [teacherKeyword, setTeacherKeyword] = useState('');
  const [chosenTeacher, setChosenTeacher] = useState<Teacher | undefined>(preselectedTeacher || undefined);
  const teacherSearch = useTeacherSearch(teachers, { query: teacherKeyword }, Boolean(teacherKeyword.trim()));
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [selectedCourseName, setSelectedCourseName] = useState<string>('');
  const [terms, setTerms] = useState<Term[]>([]);
  const [termsLoading, setTermsLoading] = useState(true);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [termId, setTermId] = useState('');
  const [yearTerm, setYearTerm] = useState('');
  const [isAnonymous, setIsAnonymous] = useState<boolean>(true);
  const [customNickname, setCustomNickname] = useState<string>(
    currentUser?.user_metadata?.nickname || '石大学子'
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successNotice, setSuccessNotice] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Six independent decimal inputs. Empty by design: no score is preselected.
  const emptyRatingInputs = {
    attendanceStrictness: '',
    gradingLeniency: '',
    effortMatters: '',
    workloadDifficulty: '',
    approachability: '',
    teachingQuality: '',
  };
  const [ratingInputs, setRatingInputs] = useState<Record<keyof typeof emptyRatingInputs, string>>(emptyRatingInputs);
  const [ratingErrors, setRatingErrors] = useState<Partial<Record<keyof typeof emptyRatingInputs, string>>>({});

  const currentTeacher = chosenTeacher || teachers.find((t) => t.id === selectedTeacherId);
  const teacherChoices = teacherKeyword.trim() ? teacherSearch.items : currentTeacher ? [currentTeacher] : [];

  // Only real teacher × course offerings can be reviewed. There is no free-text
  // course fallback and no "first course in the catalog" guess.
  const courseOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; badge?: string }> = [];
    const seen = new Set<string>();
    if (!termId) return options;
    for (const off of currentTeacher?.courseOfferings || []) {
      if (!off.courseId || seen.has(off.courseId)) continue;
      // Only offer courses that belong to the selected term. A teacher can have
      // historical offerings while the default current term has none.
      if (off.termId !== termId) continue;
      seen.add(off.courseId);
      options.push({
        value: off.courseId,
        label: off.courseName,
        badge: off.isCurrentTerm ? '本学期开课' : '历史开课',
      });
    }
    return options;
  }, [currentTeacher, termId]);

  useEffect(() => {
    if (courseOptions.length === 0) {
      setSelectedCourseId('');
      setSelectedCourseName('');
      return;
    }
    const currentExists = courseOptions.find((o) => o.value === selectedCourseId);
    if (!currentExists) {
      setSelectedCourseId(courseOptions[0].value);
      setSelectedCourseName(courseOptions[0].label);
    }
  }, [courseOptions, selectedCourseId]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setTermsLoading(true);
    setTermsError(null);
    supabaseService.getTerms()
      .then((list) => {
        if (!active) return;
        setTerms(list);
        if (list.length === 0) {
          setTermsError('学期字典尚未初始化，请联系管理员导入学期后再提交评价。');
          setTermId('');
          setYearTerm('');
          return;
        }
        const selected = list.find((term) => term.id === termId)
          || list.find((term) => term.isCurrent)
          || list[0];
        setTermId(selected.id);
        setYearTerm(selected.yearTerm);
      })
      .catch((error) => {
        if (!active) return;
        setTermsError(error instanceof Error ? error.message : '学期字典加载失败');
        setTerms([]);
      })
      .finally(() => {
        if (active) setTermsLoading(false);
      });
    return () => { active = false; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setRatingInputs({ ...emptyRatingInputs });
    setRatingErrors({});
    setSubmitError(null);
    // emptyRatingInputs is intentionally a stable six-key literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleTeacherChange = (teacherId: string) => {
    setSelectedTeacherId(teacherId);
    setChosenTeacher(teacherChoices.find(t => t.id === teacherId));
    setSelectedCourseId('');
    setSelectedCourseName('');
  };

  const handleCourseChange = (val: string) => {
    const matched = courseOptions.find((o) => o.value === val);
    if (!matched) return;
    setSelectedCourseId(matched.value);
    setSelectedCourseName(matched.label);
  };

  const handleTermChange = (nextTermId: string) => {
    const term = terms.find((item) => item.id === nextTermId);
    if (!term) return;
    setTermId(term.id);
    setYearTerm(term.yearTerm);
  };

  const handleRatingInput = (key: keyof typeof emptyRatingInputs, value: string) => {
    setRatingInputs((prev) => ({ ...prev, [key]: value }));
    setRatingErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleRatingBlur = (key: keyof typeof emptyRatingInputs) => {
    const error = validateNewRatingInput(ratingInputs[key]);
    if (error) {
      setRatingErrors((prev) => ({ ...prev, [key]: error }));
      return;
    }
    setRatingInputs((prev) => ({ ...prev, [key]: formatNewRatingInput(prev[key]) }));
    setRatingErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!currentTeacher || !selectedTeacherId) {
      setSubmitError('请先搜索并选择要评价的教师。');
      return;
    }

    if (!termId || !yearTerm) {
      setSubmitError('请选择有效学期；学期字典未初始化时不能提交评价。');
      return;
    }

    if (!selectedCourseId) {
      setSubmitError('该教师暂无已导入的开课关系，暂不能提交评价。');
      return;
    }

    const nextErrors: Partial<Record<keyof typeof emptyRatingInputs, string>> = {};
    const nextDimensions = {} as Record<keyof typeof emptyRatingInputs, number>;
    for (const dimension of RATING_DIMENSIONS) {
      const error = validateNewRatingInput(ratingInputs[dimension.key]);
      if (error) nextErrors[dimension.key] = error;
      else nextDimensions[dimension.key] = parseNewRatingInput(ratingInputs[dimension.key])!;
    }
    if (Object.keys(nextErrors).length > 0) {
      setRatingErrors(nextErrors);
      setSubmitError('请先完成六项评分，每项填写 4.0–5.0 且最多一位小数。');
      return;
    }
    const dimensionError = validateNewRatingDimensions(nextDimensions);
    if (dimensionError) {
      setSubmitError(dimensionError);
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await onSubmitReview({
        teacherId: selectedTeacherId,
        courseId: selectedCourseId,
        courseName: selectedCourseName,
        termId,
        yearTerm,
        dimensions: nextDimensions,
        comment: undefined,
        authorNickname: isAnonymous
          ? '匿名石大学子'
          : (customNickname.trim() || currentUser?.user_metadata?.nickname || '石大学子'),
        isHistoricalMigrated: false,
        status: 'pending', // <--- Initial status: pending
      });

      if (res && !res.success) {
        setSubmitError(res.message || '评价未能成功存入数据库，请检查网络或登录状态后重试。');
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      setSuccessNotice(true);
      setTimeout(() => {
        setSuccessNotice(false);
        onClose();
      }, 2000);
    } catch (err: any) {
      setIsSubmitting(false);
      setSubmitError(err?.message || '网络连接异常，提交失败');
    }
  };

  const dimensionDefinitions = RATING_DIMENSIONS;

  return (
    <ModalFrame id="review-modal" label="撰写评价" onClose={onClose}>
      {/* Backdrop */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-xs"
      />

      <motion.div 
        id="review-modal-content"
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 30, scale: 0.96 }}
        transition={{ type: 'spring', damping: 28, stiffness: 350 }}
        className="modal-panel relative z-10 bg-white w-full max-w-xl h-[88vh] h-[88dvh] sm:h-auto max-h-[88vh] max-h-[88dvh] sm:max-h-[85vh] rounded-t-3xl sm:rounded-3xl flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="shrink-0 p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white">
          <div>
            <h3 className="text-lg font-bold text-gray-900">撰写课堂反馈 & 打分</h3>
            <p className="text-xs text-gray-500">
              六维评分，越高越好 · 审核通过可获得 <strong className="text-amber-600">+20 积分</strong>
            </p>
          </div>
          <motion.button 
            id="close-review-modal-btn"
            whileTap={{ scale: 0.88 }}
            onClick={onClose}
            data-modal-close aria-label="关闭窗口"
            className="p-2 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </motion.button>
        </div>

        {successNotice ? (
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="p-10 flex flex-col items-center justify-center text-center space-y-3 flex-1"
          >
            <motion.div 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', damping: 15, stiffness: 300, delay: 0.1 }}
              className="w-16 h-16 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center"
            >
              <ShieldCheck className="w-8 h-8" />
            </motion.div>
            <h4 className="text-xl font-bold text-gray-900">评价已提交审核！</h4>
            <p className="text-xs text-gray-500 max-w-sm leading-relaxed">
              根据审核规范，评价正进入学工/学生审核组复核流程（预计24小时内公示）。
              <br />
              <strong>审核通过后将自动计入教师主页，并即时发放 <span className="text-amber-600 font-bold">+20 积分</span> 奖励！</strong>
            </p>
            <span className="px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
              可在【个人中心 - 我的评价】查看审核进度与状态
            </span>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="p-5 pb-6 overflow-y-auto min-h-0 space-y-5 flex-1 overscroll-contain">
              {/* Submission Error Banner */}
              {submitError && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium flex items-start gap-2.5"
                >
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">评价提交未完成</p>
                    <p className="text-2xs text-rose-600 mt-0.5 leading-relaxed">{submitError}</p>
                  </div>
                </motion.div>
              )}

              {/* Teacher & Course Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">选择老师</label>
                  <AnimatedDropdown
                    id="review-teacher-select"
                    className="w-full"
                    value={selectedTeacherId}
                    selectedOption={currentTeacher ? { value: currentTeacher.id, label: currentTeacher.name, badge: currentTeacher.college } : undefined}
                    onChange={handleTeacherChange}
                    options={teacherChoices.map((t) => ({
                      value: t.id,
                      label: t.name,
                      badge: t.college,
                    }))}
                    searchable
                    searchPlaceholder="输入教师姓名或课程名"
                    emptyMessage={teacherKeyword.trim() ? '无匹配教师，请换个关键词' : '输入姓名或课程名搜索教师'}
                    onSearchChange={setTeacherKeyword}
                    loading={teacherSearch.loading}
                    placeholder="请选择教师..."
                    buttonClassName="w-full bg-gray-50 hover:bg-gray-100/90 text-gray-800 rounded-xl px-3.5 py-2.5 border border-gray-200"
                    menuClassName="w-full"
                  />
                  <PageFeedback loading={false} error={teacherSearch.error} onRetry={teacherSearch.reload} />
                  {teacherSearch.total > 20 && <p className="mt-1 text-xs text-gray-400">匹配较多，请输入更完整的姓名或课程名。</p>}
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">修读课程</label>
                  <AnimatedDropdown
                    id="review-course-select"
                    className="w-full"
                    value={selectedCourseId}
                    onChange={handleCourseChange}
                    options={courseOptions}
                    selectedOption={courseOptions.find(o => o.value === selectedCourseId)}
                    placeholder={currentTeacher ? '该教师暂无已导入的开课关系' : '请先选择教师'}
                    emptyMessage="该教师暂无已导入的开课关系"
                    buttonClassName="w-full bg-gray-50 hover:bg-gray-100/90 text-gray-800 rounded-xl px-3.5 py-2.5 border border-gray-200"
                    menuClassName="w-full"
                  />
                  {currentTeacher && courseOptions.length === 0 && (
                    <p className="mt-1 text-2xs text-amber-700 leading-relaxed">
                      {termId
                        ? '该学期没有已导入的开课关系，请切换学期或联系管理员导入教师 × 课程 × 学期数据。'
                        : '请先选择学期；没有开课关系时不能提交评价。'}
                    </p>
                  )}
                </div>
              </div>

              {/* Term and Anonymity Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">修读学期</label>
                  <AnimatedDropdown
                    id="review-term-select"
                    className="w-full"
                    value={termId}
                    selectedOption={terms.find((term) => term.id === termId)
                      ? {
                        value: termId,
                        label: `${yearTerm}${terms.find((term) => term.id === termId)?.isCurrent ? '（当前学期）' : ''}`,
                      }
                      : undefined}
                    onChange={handleTermChange}
                    options={terms.map((term) => ({
                      value: term.id,
                      label: `${term.yearTerm}${term.isCurrent ? '（当前学期）' : ''}`,
                    }))}
                    loading={termsLoading}
                    placeholder="请选择学期..."
                    emptyMessage="学期字典尚未初始化"
                    buttonClassName="w-full bg-gray-50 hover:bg-gray-100/90 text-gray-800 rounded-xl px-3.5 py-2.5 text-xs border border-gray-200"
                    menuClassName="w-full max-h-56"
                  />
                  {termsError && (
                    <p className="mt-1 text-2xs text-rose-600 leading-relaxed">{termsError}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">发布身份</label>
                  <div className="flex items-center gap-1.5 p-1 bg-gray-50 rounded-xl border border-gray-200">
                    <button
                      type="button"
                      onClick={() => setIsAnonymous(true)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isAnonymous
                          ? 'bg-white text-indigo-700 shadow-2xs border border-indigo-100 font-bold'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>匿名评价</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAnonymous(false)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        !isAnonymous
                          ? 'bg-white text-indigo-700 shadow-2xs border border-indigo-100 font-bold'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <User className="w-3.5 h-3.5" />
                      <span>公开昵称</span>
                    </button>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-2xs text-gray-400 px-0.5">
                    {isAnonymous ? (
                      <span>对外署名：<strong className="text-gray-600 font-medium">匿名学子</strong>（保护隐私）</span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <span>对外署名：</span>
                        <input
                          type="text"
                          value={customNickname}
                          onChange={(e) => setCustomNickname(e.target.value)}
                          placeholder="公开昵称"
                          maxLength={12}
                          className="px-2 py-0.5 bg-white border border-gray-200 rounded text-gray-800 text-2xs font-medium w-28 focus:outline-hidden focus:border-indigo-500"
                        />
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Six required decimal scores; deliberately not a 1–5 button picker. */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-wrap items-center justify-between gap-1 border-b border-gray-100 pb-2">
                  <h4 className="text-sm font-bold text-gray-900">六项课堂评分（必填）</h4>
                  <span className="text-2xs text-gray-500">{NEW_RATING_HINT}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {dimensionDefinitions.map((item) => {
                    const error = ratingErrors[item.key];
                    const inputId = `review-rating-${item.key}`;
                    const errorId = `${inputId}-error`;
                    return (
                      <div key={item.key} className="p-3 bg-gray-50/70 rounded-2xl border border-gray-100">
                        <div className="flex items-start justify-between gap-2">
                          <label htmlFor={inputId} className="text-xs font-bold text-gray-800">
                            {item.label}
                          </label>
                          <span className="text-2xs text-gray-400 text-right">{item.highDesc}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            id={inputId}
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            maxLength={4}
                            value={ratingInputs[item.key]}
                            onChange={(e) => handleRatingInput(item.key, e.target.value)}
                            onBlur={() => handleRatingBlur(item.key)}
                            placeholder="4.0"
                            aria-invalid={Boolean(error)}
                            aria-describedby={error ? errorId : undefined}
                            className={`w-24 rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-gray-900 tabular-nums outline-hidden transition-colors focus:border-indigo-500 ${
                              error ? 'border-rose-300 focus:border-rose-500' : 'border-gray-200'
                            }`}
                          />
                          <span className="text-xs text-gray-500">分</span>
                        </div>
                        {error && (
                          <p id={errorId} role="alert" className="mt-1.5 text-2xs font-medium text-rose-600">
                            {error}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-2xs text-gray-400">可输入 4、4.1、5 等；失焦后统一显示一位小数，六项均需填写。</p>
              </div>

              {/* Policy note */}
              <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 flex items-start gap-2 text-2xs text-blue-800">
                <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  <strong>社区公约：</strong>严禁注水评价（如仅输入“很好”）及人身攻击、虚假编造事实。宽松审核，真实体验即可通过。
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 p-4 pb-7 sm:pb-4 border-t border-gray-100 bg-white flex items-center justify-between">
              <motion.button
                type="button"
                whileTap={{ scale: 0.94 }}
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 cursor-pointer"
              >
                取消
              </motion.button>
              <motion.button
                id="submit-review-btn"
                type="submit"
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.02 }}
                disabled={isSubmitting || !termId || !selectedCourseId}
                className="px-6 py-2.5 bg-blue-900 hover:bg-blue-800 active:bg-blue-950 disabled:opacity-50 text-white rounded-xl text-sm font-semibold shadow-md shadow-blue-100 transition-all flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
              >
                {isSubmitting ? '正在提交...' : '提交审核 (+20分待审)'}
              </motion.button>
            </div>
          </form>
        )}
      </motion.div>

    </ModalFrame>
  );
};
