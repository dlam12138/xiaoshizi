/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Teacher, Review, UserPointTransaction } from './types';
import { supabaseService } from './services/supabaseService';
import { isSupabaseConfigured, supabaseConfiguration } from './lib/supabase';
import { UPC_APP_NAME, UPC_APP_SHORT_NAME, UPC_SCHOOL_NAME } from './config/upc';

// Mobile Dedicated Views (Clean, pure Quark layout matching reference image)
import { MobileQuarkHome } from './components/mobile/MobileQuarkHome';
import { MobileUserProfile } from './components/mobile/MobileUserProfile';
import { MobileTeacherSearch } from './components/mobile/MobileTeacherSearch';
import { MobileServicesView } from './components/mobile/MobileServicesView';
import { BottomNav, NavTab } from './components/BottomNav';

// Desktop Dedicated Views (Spacious 2-column wide screen layout)
import { DesktopQuarkHome } from './components/desktop/DesktopQuarkHome';
import { DesktopUserProfile } from './components/desktop/DesktopUserProfile';
import { DesktopTeacherSearch } from './components/desktop/DesktopTeacherSearch';

// Shared Functional Components
import { clearPagedQueryCache } from './hooks/usePagedQuery';

// Modals are only mounted when the user opens them, so load them on demand
// instead of shipping every dialog in the entry bundle.
const TeacherDetailModal = lazy(() => import('./components/TeacherDetailModal').then(m => ({ default: m.TeacherDetailModal })));
const ReviewModal = lazy(() => import('./components/ReviewModal').then(m => ({ default: m.ReviewModal })));
const UserPointsModal = lazy(() => import('./components/UserPointsModal').then(m => ({ default: m.UserPointsModal })));
const CollegeListModal = lazy(() => import('./components/CollegeListModal').then(m => ({ default: m.CollegeListModal })));
const AuthModal = lazy(() => import('./components/AuthModal').then(m => ({ default: m.AuthModal })));
const AdminAuditModal = lazy(() => import('./components/AdminAuditModal').then(m => ({ default: m.AdminAuditModal })));

// Modals are user-triggered, so the split chunk normally arrives immediately.
// Rendering nothing avoids a flash of placeholder inside the open animation.
const LazyFallback = () => null;

import { 
  BookOpen, 
  Search, 
  User, 
  Coins, 
  UserPlus,
  LogIn,
  LogOut,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Info,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  // Current logged in user via Supabase Auth
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register' | 'forgot' | 'recovery'>('login');

  // Core application states. No mock or old-school fallback is ever substituted.
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherTotal, setTeacherTotal] = useState(0);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [likedReviewIds, setLikedReviewIds] = useState<Set<string>>(new Set());
  const [pendingLikeIds, setPendingLikeIds] = useState<Set<string>>(new Set());
  const likeRequests = useRef(new Set<string>());
  const likeSyncVersion = useRef(0);
  const [likesLoading, setLikesLoading] = useState(false);
  const [likesReady, setLikesReady] = useState(false);
  const [userPoints, setUserPoints] = useState<number>(0);
  const [hasCheckedInToday, setHasCheckedInToday] = useState<boolean>(false);
  const [isCheckingIn, setIsCheckingIn] = useState<boolean>(false);
  const [isCheckinStatusLoading, setIsCheckinStatusLoading] = useState<boolean>(false);
  const [transactions, setTransactions] = useState<UserPointTransaction[]>([]);

  // Floating feedback Toast system (replaces jarring synchronous alerts)
  const [appToast, setAppToast] = useState<{
    id: number;
    message: string;
    type: 'success' | 'info' | 'error';
  } | null>(null);

  const showAppToast = useCallback((message: string, type: 'success' | 'info' | 'error' = 'info') => {
    const id = Date.now();
    setAppToast({ id, message, type });
    setTimeout(() => {
      setAppToast((prev) => (prev?.id === id ? null : prev));
    }, 4000);
  }, []);

  // Navigation tab
  const [currentTab, setCurrentTab] = useState<NavTab>('home');
  const [initialTeacherSearch, setInitialTeacherSearch] = useState<string>('');

  // Modals state
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);
  const [reviewTargetTeacher, setReviewTargetTeacher] = useState<Teacher | null>(null);
  const [isPointsModalOpen, setIsPointsModalOpen] = useState<boolean>(false);
  const [isCollegesModalOpen, setIsCollegesModalOpen] = useState<boolean>(false);
  const [colleges, setColleges] = useState<Array<{ id: string; name: string; code?: string }>>([]);
  const [isAdminAuditModalOpen, setIsAdminAuditModalOpen] = useState<boolean>(false);
  const [isUserAdmin, setIsUserAdmin] = useState<boolean>(false);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  useEffect(() => {
    if (!isSupabaseConfigured || !isUserAdmin) { setPendingReviewCount(0); return; }
    let active = true;
    supabaseService.getReviewCounts().then(counts => {
      if (active) setPendingReviewCount(counts.pending);
    }).catch(() => {});
    return () => { active = false; };
  }, [isUserAdmin, reviewRevision]);

  const reviewScopeRef = useRef({ profile: false });
  reviewScopeRef.current = { profile: currentTab === 'profile' };
  const rememberTeachers = useCallback((items: Teacher[]) => {
    setTeachers(previous => Array.from(new Map([...previous, ...items].map(t => [t.id, t])).values()));
  }, []);
  const loadFeaturedTeachers = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const result = await supabaseService.getTeachersPage({ pageSize: 20 });
      setTeacherTotal(result.total);
      setTeachers(previous => [...result.items, ...previous.filter(t => !result.items.some(item => item.id === t.id))]);
    } catch (error) { console.warn('教师读取失败', error); }
  }, []);
  useEffect(() => {
    if (selectedTeacher) rememberTeachers([selectedTeacher]);
  }, [selectedTeacher, rememberTeachers]);

  // Automatic Device Detection: Accurately identifies mobile phone vs computer/desktop
  const [deviceInfo, setDeviceInfo] = useState<{ isMobile: boolean; screenWidth: number }>(() => {
    if (typeof window === 'undefined') return { isMobile: false, screenWidth: 1200 };
    const userAgent = navigator.userAgent || '';
    const isMobileUA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    const isSmallScreen = window.innerWidth < 768;
    return {
      isMobile: isMobileUA || isSmallScreen,
      screenWidth: window.innerWidth,
    };
  });

  useEffect(() => {
    const handleResize = () => {
      const userAgent = navigator.userAgent || '';
      const isMobileUA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
      const isSmallScreen = window.innerWidth < 768;
      setDeviceInfo({
        isMobile: isMobileUA || isSmallScreen,
        screenWidth: window.innerWidth,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const currentUserIdRef = useRef<string | null>(null);
  const pointsRequestRef = useRef(0);
  const applyCurrentUser = useCallback((user: any | null) => {
    const nextId = user?.id || null;
    if (currentUserIdRef.current !== nextId) {
      currentUserIdRef.current = nextId;
      pointsRequestRef.current++;
      setUserPoints(0);
      setTransactions([]);
      setHasCheckedInToday(false);
    }
    setCurrentUser(user);
  }, []);

  const loadUserPointsData = useCallback(async (userId: string) => {
    const request = ++pointsRequestRef.current;
    setIsCheckinStatusLoading(true);
    try {
      const pointData = await supabaseService.getUserPoints(userId);
      if (pointData && request === pointsRequestRef.current && currentUserIdRef.current === userId) {
        setUserPoints(pointData.points);
        setTransactions(pointData.transactions);
        if (typeof pointData.hasCheckedInToday === 'boolean') {
          setHasCheckedInToday(pointData.hasCheckedInToday);
        }
      }
    } catch (err) {
      if (request === pointsRequestRef.current && currentUserIdRef.current === userId) {
        setUserPoints(0);
        setTransactions([]);
        setHasCheckedInToday(false);
      }
      console.warn('Failed to load user points data:', err);
    } finally {
      if (request === pointsRequestRef.current) setIsCheckinStatusLoading(false);
    }
  }, []);

  // Refresh reviews from Supabase & local cache (remote status always takes precedence)
  const handleRefreshReviews = useCallback(async () => {
    setReviewRevision(value => value + 1);
    const likeVersion = ++likeSyncVersion.current;
    const userId = currentUserIdRef.current;
    try {
      // The homepage never downloads the school-wide review corpus.
      if (userId && reviewScopeRef.current.profile) {
        const ownReviews = await supabaseService.getReviews(undefined, { userId });
        if (currentUserIdRef.current !== userId || likeSyncVersion.current !== likeVersion) return;
        setReviews(ownReviews);
        const ids = [...new Set(ownReviews.map(r => r.teacherId))];
        const related = await Promise.all(ids.map(id => supabaseService.getTeacherById(id).catch(() => null)));
        if (currentUserIdRef.current === userId) rememberTeachers(related.filter((t): t is Teacher => t !== null));
      }
      if (userId) {
        setLikesLoading(true);
        try {
          const ids = await supabaseService.getMyLikedReviewIds();
          if (currentUserIdRef.current === userId && likeSyncVersion.current === likeVersion) {
            setLikedReviewIds(new Set(ids)); setLikesReady(true);
          }
        } catch {
          if (currentUserIdRef.current === userId && likeSyncVersion.current === likeVersion) setLikesReady(false);
        } finally {
          if (likeSyncVersion.current === likeVersion) setLikesLoading(false);
        }
      }
    } catch (error) {
      if (currentUserIdRef.current === userId) {
        showAppToast(error instanceof Error ? error.message : '评价数据加载失败，请稍后重试', 'error');
      }
    }
  }, [rememberTeachers, showAppToast]);

  useEffect(() => {
    setLikedReviewIds(new Set()); setLikesReady(false); setLikesLoading(false);
    if (isSupabaseConfigured) setReviews([]);
    handleRefreshReviews();
  }, [currentUser?.id, handleRefreshReviews]);

  // A recovery link may establish its session before the auth listener mounts.
  useEffect(() => {
    if (isSupabaseConfigured && supabaseService.hasRecoveryParams()) {
      setAuthModalMode('recovery');
      setIsAuthModalOpen(true);
    }
  }, []);

  // Sync Supabase Auth, Initial Data, and Realtime Listeners
  useEffect(() => {
    loadFeaturedTeachers();

    // Load colleges list
    if (isSupabaseConfigured) {
      supabaseService.getColleges().then((data) => {
        if (data && data.length > 0) {
          setColleges(data);
        }
      });
    }

    if (!isSupabaseConfigured) return;

    // Only authoritative balances are displayed after session restoration.
    supabaseService.getCurrentUser().then((user) => {
      if (user) {
        applyCurrentUser(user);
        loadUserPointsData(user.id);
      }
    });

    // Subscribe to auth state changes
    const { data: authListener } = supabaseService.onAuthStateChange((event, session) => {
      const user = session?.user || null;
      if (event === 'PASSWORD_RECOVERY') {
        setAuthModalMode('recovery');
        setIsAuthModalOpen(true);
      }
      if (event === 'SIGNED_OUT') {
        applyCurrentUser(null);
        setUserPoints(0);
        setTransactions([]);
        setHasCheckedInToday(false);
      } else if (user) {
        applyCurrentUser(user);
        // Leave the Supabase auth callback before starting another auth request.
        setTimeout(() => {
          if (currentUserIdRef.current === user.id) loadUserPointsData(user.id);
        }, 0);
      }
    });

    // Subscribe to real-time reviews changes (e.g. admin approval from another device)
    const reviewsSub = supabaseService.subscribeToReviews(() => {
      handleRefreshReviews();
      supabaseService.getCurrentUser().then((u) => {
        if (u) loadUserPointsData(u.id);
      });
    });

    // Window focus and visibility listeners for auto background sync
    const handleSyncOnActive = () => {
      handleRefreshReviews();
      supabaseService.getCurrentUser().then((u) => {
        if (u) loadUserPointsData(u.id);
      });
    };

    window.addEventListener('focus', handleSyncOnActive);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleSyncOnActive();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      authListener?.subscription?.unsubscribe();
      reviewsSub?.unsubscribe();
      window.removeEventListener('focus', handleSyncOnActive);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [handleRefreshReviews, loadUserPointsData, applyCurrentUser, loadFeaturedTeachers]);

  // Re-sync reviews and user points whenever user navigates to the 'profile' tab
  useEffect(() => {
    if (currentTab === 'profile') {
      handleRefreshReviews();
      if (currentUser) {
        loadUserPointsData(currentUser.id);
      }
    }
  }, [currentTab, currentUser, handleRefreshReviews, loadUserPointsData]);

  // Verify administrator privilege whenever currentUser changes
  useEffect(() => {
    let isMounted = true;
    if (!currentUser || !currentUser.email) {
      setIsUserAdmin(false);
      setIsAdminAuditModalOpen(false);
      return;
    }

    setIsUserAdmin(false);
    supabaseService.checkIsAdmin().then((res) => {
      if (isMounted) {
        setIsUserAdmin(res.isAdmin);
        if (!res.isAdmin) setIsAdminAuditModalOpen(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [currentUser]);

  const handleOpenAuth = (mode: 'login' | 'register' = 'login') => {
    setAuthModalMode(mode);
    setIsAuthModalOpen(true);
  };

  const handleLogout = async () => {
    await supabaseService.signOut();
    applyCurrentUser(null);
    setIsUserAdmin(false);
    setIsAdminAuditModalOpen(false);
    setUserPoints(0);
    setTransactions([]);
    setHasCheckedInToday(false);
  };

  const viewMode: 'mobile' | 'desktop' = deviceInfo.isMobile ? 'mobile' : 'desktop';

  // Daily Check-in Handler via handle_daily_checkin RPC function
  const handleCheckIn = async () => {
    if (!currentUser) {
      handleOpenAuth('login');
      return;
    }

    if (isCheckingIn || isCheckinStatusLoading || hasCheckedInToday) {
      if (hasCheckedInToday) {
        showAppToast('您今日已经完成签到啦，明日 00:00 后即可再次签到！', 'info');
      }
      return;
    }

    setIsCheckingIn(true);
    try {
      const res = await supabaseService.handleDailyCheckin(currentUser.id);
      if (currentUserIdRef.current !== currentUser.id) return;
      if (!res.success) {
        showAppToast(res.message || '签到失败，请稍后重试', 'error');
        return;
      }

      pointsRequestRef.current++;
      setIsCheckinStatusLoading(false);
      setHasCheckedInToday(true);
      setUserPoints(res.points);

      if (res.alreadyCheckedIn) {
        showAppToast('您今日已经完成签到啦，明日 00:00 后即可再次签到领取积分！', 'info');
        return;
      }

      setTransactions((prev) => [
        {
          id: `tx_${Date.now()}`,
          action: '每日签到奖励',
          amount: 5,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          balanceAfter: res.points,
        },
        ...prev,
      ]);
      showAppToast('🎉 签到成功！已获得 +5 积分奖励', 'success');
    } catch (err: any) {
      showAppToast(err?.message || '签到异常，请稍后重试', 'error');
    } finally {
      setIsCheckingIn(false);
    }
  };

  // Guarded Review Open: Requires User Login!
  const handleOpenReview = (teacher?: Teacher | null) => {
    if (teacher) rememberTeachers([teacher]);
    if (!currentUser) {
      handleOpenAuth('login');
      return;
    }
    setReviewTargetTeacher(teacher || null);
    setIsReviewModalOpen(true);
  };

  // Submit Review Handler (Audit State Machine: initial status is 'pending')
  const handleSubmitReview = async (
    newReviewData: Omit<Review, 'id' | 'createdAt' | 'likes'>
  ): Promise<{ success: boolean; message?: string }> => {
    if (!currentUser) {
      handleOpenAuth('login');
      return { success: false, message: '请先登录您的石大账号' };
    }

    const nickname = currentUser.user_metadata?.nickname || '石大学子';
    const nowIso = new Date().toISOString();
    const newReview: Review = {
      ...newReviewData,
      id: `rev_${Date.now()}`,
      userId: currentUser.id,
      userEmail: currentUser.email,
      authorNickname: nickname,
      createdAt: nowIso,
      likes: 0,
      status: 'pending', // 初始状态为待审核
      ratingVersion: 2,
    };

    // Persist to Supabase and cache with full RLS validation
    const res = await supabaseService.submitReview(newReview);
    if (!res.success) {
      return res;
    }

    // Add into current reviews list
    setReviews((prev) => [newReview, ...prev]);

    // Refresh remote reviews list
    handleRefreshReviews();

    return { success: true };
  };

  // Approve review handler: calls approve_review RPC function with server-side validation
  const handleApproveReview = async (reviewId: string, _authorUserId?: string): Promise<{ success: boolean; message?: string }> => {
    const originalReview = reviews.find((r) => r.id === reviewId);

    // 1. Optimistic UI update: Immediately reflect approved status in local React state
    setReviews((prev) =>
      prev.map((r) =>
        r.id === reviewId ? { ...r, status: 'approved', rejectionReason: undefined } : r
      )
    );

    const res = await supabaseService.approveReview(reviewId);

    // Roll back if rejected by database
    if (!res.success) {
      if (originalReview) {
        setReviews((prev) =>
          prev.map((r) => (r.id === reviewId ? originalReview : r))
        );
      }
      return res;
    }

    // 2. Refresh reviews and teachers from remote (DB trigger calculates scores and review counts)
    handleRefreshReviews();
    loadFeaturedTeachers();
    // Approving changes teacher scores, so cached library pages must not be reused.
    clearPagedQueryCache();

    // 3. If current user is author, reload user points (+20 awarded by approve_review function)
    if (currentUser) {
      loadUserPointsData(currentUser.id);
    }

    return res;
  };

  // Reject review handler: calls reject_review RPC function with server-side validation
  const handleRejectReview = async (reviewId: string, reason: string): Promise<{ success: boolean; message?: string }> => {
    const originalReview = reviews.find((r) => r.id === reviewId);

    // 1. Optimistic UI update: Immediately reflect rejected status in local React state
    setReviews((prev) =>
      prev.map((r) =>
        r.id === reviewId ? { ...r, status: 'rejected', rejectionReason: reason } : r
      )
    );

    const res = await supabaseService.rejectReview(reviewId, reason);

    // Roll back if rejected by database
    if (!res.success) {
      if (originalReview) {
        setReviews((prev) =>
          prev.map((r) => (r.id === reviewId ? originalReview : r))
        );
      }
      return res;
    }

    handleRefreshReviews();
    return res;
  };

  // Delete review handler
  const handleDeleteReview = async (reviewId: string) => {
    const success = await supabaseService.deleteReview(reviewId);
    if (!success) {
      alert('删除失败，请刷新后重试');
      return;
    }
    setReviews((prev) => prev.filter((r) => r.id !== reviewId));
    handleRefreshReviews();
  };

  // Like review
  const handleLikeReview = async (reviewId: string) => {
    const uid = currentUserIdRef.current;
    if (!uid) { handleOpenAuth('login'); return; }
    if (!likesReady) {
      showAppToast('点赞状态尚未同步，请稍后重试', 'error'); handleRefreshReviews(); return;
    }
    if (likeRequests.current.has(reviewId)) return;
    likeRequests.current.add(reviewId); setPendingLikeIds(new Set(likeRequests.current));
    ++likeSyncVersion.current;
    try {
      const result = await supabaseService.setReviewLike(reviewId, !likedReviewIds.has(reviewId));
      if (currentUserIdRef.current !== uid) return;
      ++likeSyncVersion.current;
      setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, likes: result.likes } : r));
      setLikedReviewIds(prev => { const next=new Set(prev); result.liked ? next.add(reviewId) : next.delete(reviewId); return next; });
    } catch (error) {
      if (currentUserIdRef.current === uid) {
        showAppToast(error instanceof Error ? error.message : '点赞未保存，请重试', 'error');
        handleRefreshReviews();
      }
    } finally {
      likeRequests.current.delete(reviewId); setPendingLikeIds(new Set(likeRequests.current));
      setLikesLoading(false);
    }
  };


  const myReviews = currentUser
    ? reviews.filter((r) => r.userId === currentUser.id)
    : [];

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-5">
        <div className="w-full max-w-lg bg-white rounded-3xl border border-gray-200 shadow-xl p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-900 text-white flex items-center justify-center font-bold text-lg">
              石
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-950">{UPC_APP_NAME}</h1>
              <p className="text-xs text-gray-500">环境配置检查</p>
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-sm space-y-2">
            <div className="flex items-center gap-2 font-bold">
              <AlertCircle className="w-4 h-4" />
              <span>数据库尚未就绪，应用已停止连接</span>
            </div>
            <p className="text-xs leading-relaxed">
              {supabaseConfiguration.error || '缺少 UPC Supabase 配置。'}
            </p>
          </div>
          <div className="text-xs text-gray-600 space-y-2">
            <p className="font-semibold text-gray-800">本地配置步骤</p>
            <ol className="list-decimal list-inside space-y-1 leading-relaxed">
              <li>复制 `.env.example` 为 `.env.local`。</li>
              <li>填写独立 UPC 项目的 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`。</li>
              <li>重新执行 `npm run build` 并刷新页面。</li>
            </ol>
            <p className="text-2xs text-gray-500 pt-1">
              本项目不会回退到旧校数据库，也不会加载 mock 教师或旧校评价。
            </p>
          </div>
          <div className="flex items-center gap-2 text-2xs text-gray-400 border-t border-gray-100 pt-4">
            <Info className="w-3.5 h-3.5" />
            <span>{UPC_SCHOOL_NAME} · 独立部署环境</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white sm:bg-slate-100/90 text-gray-900 flex flex-col items-center relative">
      {/* Top Floating Toast Notification Banner */}
      <AnimatePresence>
        {appToast && (
          <motion.div
            initial={{ opacity: 0, y: -24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-[9999] max-w-md w-[92%] sm:w-auto px-4 py-3 rounded-2xl shadow-xl border flex items-center justify-between gap-3 text-sm font-semibold backdrop-blur-md pointer-events-auto ${
              appToast.type === 'success'
                ? 'bg-emerald-50/95 border-emerald-300 text-emerald-900 shadow-emerald-500/10'
                : appToast.type === 'error'
                ? 'bg-rose-50/95 border-rose-300 text-rose-900 shadow-rose-500/10'
                : 'bg-amber-50/95 border-amber-300 text-amber-900 shadow-amber-500/10'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {appToast.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              ) : appToast.type === 'error' ? (
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              ) : (
                <Info className="w-5 h-5 text-amber-600 shrink-0" />
              )}
              <span className="leading-snug">{appToast.message}</span>
            </div>
            <button
              onClick={() => setAppToast(null)}
              className="p-1 rounded-lg hover:bg-black/5 text-gray-400 hover:text-gray-700 transition-colors ml-2 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {/* ========================================================= */}
      {/* 1. MOBILE MODE: Pure, 100% faithful Quark mobile layout   */}
      {/* ========================================================= */}
      {viewMode === 'mobile' && (
        <div className="w-full flex justify-center py-0 sm:py-4">
          <div className="w-full max-w-[430px] min-h-screen sm:min-h-[92vh] bg-white sm:rounded-3xl sm:shadow-[0_20px_60px_rgba(0,0,0,0.12)] sm:border sm:border-gray-200/80 relative overflow-x-hidden flex flex-col justify-between">
            
            {/* Mobile Tab Views with Smooth Fade Transition */}
            <div className="flex-1 w-full relative overflow-x-hidden">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentTab}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="w-full"
                >
                  {currentTab === 'home' && (
                    <MobileQuarkHome
                      currentUser={currentUser}
                      onOpenAuth={handleOpenAuth}
                      userPoints={userPoints}
                      onOpenSearch={(query) => {
                        setInitialTeacherSearch(query || '');
                        setCurrentTab('search');
                      }}
                      onOpenPoints={() => {
                        if (!currentUser) {
                          handleOpenAuth('login');
                        } else {
                          setIsPointsModalOpen(true);
                        }
                      }}
                      onOpenReview={() => handleOpenReview()}
                    />
                  )}

                  {currentTab === 'search' && (
                    <MobileTeacherSearch
                      teachers={teachers}
                      colleges={colleges}
                      initialSearch={initialTeacherSearch}
                      onSelectTeacher={(teacher) => setSelectedTeacher(teacher)}
                      onOpenReview={(teacher) => handleOpenReview(teacher)}
                    />
                  )}

                  {currentTab === 'services' && (
                    <MobileServicesView
                      teachers={teachers}
                      userPoints={userPoints}
                      onOpenSearch={(query) => {
                        setInitialTeacherSearch(query || '');
                        setCurrentTab('search');
                      }}
                      onOpenReview={(teacher) => handleOpenReview(teacher)}
                      onOpenPoints={() => {
                        if (!currentUser) {
                          handleOpenAuth('login');
                        } else {
                          setIsPointsModalOpen(true);
                        }
                      }}
                      onOpenCollegeList={() => setIsCollegesModalOpen(true)}
                      onSelectTeacher={(teacher) => setSelectedTeacher(teacher)}
                    />
                  )}

                  {currentTab === 'profile' && (
                    <MobileUserProfile
                      currentUser={currentUser}
                      onOpenAuth={handleOpenAuth}
                      onLogout={handleLogout}
                      userPoints={userPoints}
                      transactions={transactions}
                      hasCheckedInToday={hasCheckedInToday}
                      isCheckingIn={isCheckingIn}
                      isCheckinStatusLoading={isCheckinStatusLoading}
                      onCheckIn={handleCheckIn}
                      onOpenPointsModal={() => {
                        if (!currentUser) {
                          handleOpenAuth('login');
                        } else {
                          setIsPointsModalOpen(true);
                        }
                      }}
                      onOpenReview={() => handleOpenReview()}
                      onSelectTeacher={(teacher) => setSelectedTeacher(teacher)}
                      myReviews={myReviews}
                      teachers={teachers}
                      onOpenAdminAudit={isUserAdmin ? () => setIsAdminAuditModalOpen(true) : undefined}
                      onDeleteReview={handleDeleteReview}
                      onRefreshReviews={handleRefreshReviews}
                      isUserAdmin={isUserAdmin}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Quark Mobile Bottom Navigation Dock */}
            <BottomNav
              currentTab={currentTab}
              onTabChange={(tab) => setCurrentTab(tab)}
              userPoints={userPoints}
            />
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 2. DESKTOP MODE: Spacious, full-featured wide screen view */}
      {/* ========================================================= */}
      {viewMode === 'desktop' && (
        <div className="w-full flex flex-col items-center">
          {/* Desktop Navigation Header */}
          <header className="w-full bg-white/95 backdrop-blur-md border-b border-gray-200/80 sticky top-0 z-30 shadow-2xs">
            <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
              {/* Logo */}
              <div 
                onClick={() => setCurrentTab('home')}
                className="flex items-center gap-3 cursor-pointer select-none group"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-900 text-white flex items-center justify-center font-bold text-base shadow-xs shadow-blue-200 group-hover:scale-105 transition-transform">
                  石
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-extrabold text-base tracking-tight text-gray-950 font-sans">
                      {UPC_APP_SHORT_NAME}
                    </span>
                    <span className="px-1.5 py-0.2 rounded-md text-3xs font-bold bg-blue-50 text-blue-800 border border-blue-100">
                      UPC
                    </span>
                  </div>
                </div>
              </div>

              {/* Desktop Nav Items */}
              <nav className="flex items-center gap-1.5 bg-gray-100/90 p-1.5 rounded-2xl border border-gray-200/60">
                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={() => setCurrentTab('home')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    currentTab === 'home'
                      ? 'bg-white text-gray-950 shadow-xs'
                      : 'text-gray-600 hover:text-gray-950 hover:bg-white/50'
                  }`}
                >
                  <BookOpen className="w-4 h-4" />
                  <span>首页</span>
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={() => setCurrentTab('search')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    currentTab === 'search'
                      ? 'bg-white text-gray-950 shadow-xs'
                      : 'text-gray-600 hover:text-gray-950 hover:bg-white/50'
                  }`}
                >
                  <Search className="w-4 h-4" />
                  <span>教师库 (免费)</span>
                </motion.button>

                <motion.button
                  whileTap={{ scale: 0.94 }}
                  onClick={() => setCurrentTab('profile')}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all relative ${
                    currentTab === 'profile'
                      ? 'bg-white text-gray-950 shadow-xs'
                      : 'text-gray-600 hover:text-gray-950 hover:bg-white/50'
                  }`}
                >
                  <User className="w-4 h-4" />
                  <span>个人中心</span>
                </motion.button>
              </nav>

              {/* Auth, points and administrator quick actions */}
              <div className="flex items-center gap-2.5">
                {currentUser ? (
                  <>
                    <motion.div 
                      whileTap={{ scale: 0.93 }}
                      onClick={() => setIsPointsModalOpen(true)}
                      className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 px-3 py-1.5 rounded-full border border-amber-200/80 cursor-pointer transition-all shadow-2xs"
                    >
                      <Coins className="w-3.5 h-3.5 text-amber-500" />
                      <span className="font-bold text-xs">{userPoints}</span>
                      <span className="text-3xs text-amber-700">分</span>
                    </motion.div>

                    <div className="flex items-center gap-2 pl-1 border-l border-gray-200">
                      <div 
                        onClick={() => setCurrentTab('profile')}
                        className="flex items-center gap-1.5 cursor-pointer p-1 rounded-xl hover:bg-gray-100 transition-colors"
                        title="查看个人中心"
                      >
                        <div className="w-7 h-7 rounded-lg bg-blue-900 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                          {(currentUser.user_metadata?.nickname || '石').slice(0, 1)}
                        </div>
                        <span className="text-xs font-bold text-gray-800 max-w-[80px] truncate">
                          {currentUser.user_metadata?.nickname || '石大学子'}
                        </span>
                      </div>
                      <button
                        onClick={handleLogout}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="退出登录"
                      >
                        <LogOut className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenAuth('login')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white hover:bg-gray-50 border border-gray-200 text-xs font-bold text-gray-700 transition-all shadow-2xs"
                    >
                      <LogIn className="w-3.5 h-3.5 text-gray-500" />
                      <span>登录</span>
                    </button>
                    <button
                      onClick={() => handleOpenAuth('register')}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-2xs"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>注册 (+100积分)</span>
                    </button>
                  </div>
                )}

                {/* Admin Audit Quick Switch - Only visible when an administrator is logged in */}
                {isUserAdmin && (
                  <motion.button
                    whileTap={{ scale: 0.93 }}
                    onClick={() => setIsAdminAuditModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-100 text-xs font-bold transition-all shadow-2xs cursor-pointer group"
                    title="进入反馈审核管理工作台"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 group-hover:scale-110 transition-transform" />
                    <span>管理审核</span>
                    {pendingReviewCount > 0 && (
                      <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 rounded-full text-4xs font-black animate-pulse">
                        {pendingReviewCount}
                      </span>
                    )}
                  </motion.button>
                )}
              </div>
            </div>
          </header>

          {/* Desktop Views with AnimatePresence */}
          <main className="w-full max-w-6xl mx-auto px-6 py-4 overflow-x-hidden">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentTab}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                {currentTab === 'home' && (
                  <DesktopQuarkHome
                    teacherTotal={teacherTotal}
                    currentUser={currentUser}
                    onOpenAuth={handleOpenAuth}
                    teachers={teachers}
                    userPoints={userPoints}
                    onOpenSearch={(query) => {
                      setInitialTeacherSearch(query || '');
                      setCurrentTab('search');
                    }}
                    onOpenReview={(teacher) => handleOpenReview(teacher)}
                    onOpenPoints={() => {
                      if (!currentUser) {
                        handleOpenAuth('login');
                      } else {
                        setIsPointsModalOpen(true);
                      }
                    }}
                    onOpenCollegeList={() => setIsCollegesModalOpen(true)}
                    onSelectTeacher={(teacher) => setSelectedTeacher(teacher)}
                  />
                )}

                {currentTab === 'search' && (
                  <div className="pt-2">
                    <DesktopTeacherSearch
                      teachers={teachers}
                      colleges={colleges}
                      initialSearch={initialTeacherSearch}
                      onSelectTeacher={(teacher) => setSelectedTeacher(teacher)}
                      onOpenReview={(teacher) => handleOpenReview(teacher)}
                    />
                  </div>
                )}

                {currentTab === 'profile' && (
                  <DesktopUserProfile
                    currentUser={currentUser}
                    onOpenAuth={handleOpenAuth}
                    onLogout={handleLogout}
                    userPoints={userPoints}
                    transactions={transactions}
                    hasCheckedInToday={hasCheckedInToday}
                    isCheckingIn={isCheckingIn}
                    isCheckinStatusLoading={isCheckinStatusLoading}
                    onCheckIn={handleCheckIn}
                    onOpenPointsModal={() => {
                      if (!currentUser) {
                        handleOpenAuth('login');
                      } else {
                        setIsPointsModalOpen(true);
                      }
                    }}
                    onOpenReview={() => handleOpenReview()}
                    onSelectTeacher={(teacher) => setSelectedTeacher(teacher)}
                    myReviews={myReviews}
                    teachers={teachers}
                    onOpenAdminAudit={isUserAdmin ? () => setIsAdminAuditModalOpen(true) : undefined}
                    onDeleteReview={handleDeleteReview}
                    onRefreshReviews={handleRefreshReviews}
                    isUserAdmin={isUserAdmin}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      )}

      {/* ========================================================= */}
      {/* Shared Modals                                             */}
      {/* ========================================================= */}
      
      {/* 1. 教师主页 / 详细六维评测 Modal */}
      <AnimatePresence>
        {selectedTeacher && (
          <Suspense fallback={<LazyFallback />}>
          <TeacherDetailModal
            teacher={teachers.find(t => t.id === selectedTeacher.id) || selectedTeacher}
            reviews={reviews}
            onClose={() => setSelectedTeacher(null)}
            onOpenReview={(t) => handleOpenReview(t)}
            onLikeReview={handleLikeReview}
            likedReviewIds={likedReviewIds}
            pendingLikeIds={pendingLikeIds}
            refreshToken={reviewRevision}
            likesLoading={likesLoading}
          />
          </Suspense>
        )}
      </AnimatePresence>

      {/* 2. 评价打分 Modal */}
      <AnimatePresence>
        {isReviewModalOpen && (
          <Suspense fallback={<LazyFallback />}>
          <ReviewModal
            isOpen={isReviewModalOpen}
            onClose={() => setIsReviewModalOpen(false)}
            teachers={teachers}
            preselectedTeacher={reviewTargetTeacher}
            currentUser={currentUser}
            onSubmitReview={handleSubmitReview}
          />
          </Suspense>
        )}
      </AnimatePresence>

      {/* 4. 积分中心 Modal */}
      <AnimatePresence>
        {isPointsModalOpen && (
          <Suspense fallback={<LazyFallback />}>
          <UserPointsModal
            isOpen={isPointsModalOpen}
            onClose={() => setIsPointsModalOpen(false)}
            points={userPoints}
            transactions={transactions}
            hasCheckedInToday={hasCheckedInToday}
            isCheckingIn={isCheckingIn}
            isCheckinStatusLoading={isCheckinStatusLoading}
            onCheckIn={handleCheckIn}
            onOpenReview={() => handleOpenReview()}
          />
          </Suspense>
        )}
      </AnimatePresence>

      {/* 5. 院系库 Modal */}
      <AnimatePresence>
        {isCollegesModalOpen && (
          <Suspense fallback={<LazyFallback />}>
          <CollegeListModal
            isOpen={isCollegesModalOpen}
            onClose={() => setIsCollegesModalOpen(false)}
            colleges={colleges}
            onSelectCollege={(_college, collegeId) => {
              setInitialTeacherSearch(collegeId || _college || '');
              setCurrentTab('search');
            }}
          />
          </Suspense>
        )}
      </AnimatePresence>

      {/* 6. Supabase 用户认证 Modal (登录 / 注册) */}
      <AnimatePresence>
        {isAuthModalOpen && (
          <Suspense fallback={<LazyFallback />}>
          <AuthModal
            isOpen={isAuthModalOpen}
            onClose={() => setIsAuthModalOpen(false)}
            initialMode={authModalMode}
            onAuthSuccess={(user) => {
              applyCurrentUser(user);
              loadUserPointsData(user.id);
              setIsAuthModalOpen(false);
            }}
          />
          </Suspense>
        )}
      </AnimatePresence>

      {/* 7. 管理员审核后台工作台 Modal */}
      <AnimatePresence>
        {isAdminAuditModalOpen && isUserAdmin && (
          <Suspense fallback={<LazyFallback />}>
          <AdminAuditModal
            isOpen={isAdminAuditModalOpen}
            onClose={() => setIsAdminAuditModalOpen(false)}
            reviews={reviews}
            teachers={teachers}
            onApproveReview={handleApproveReview}
            onRejectReview={handleRejectReview}
            onDeleteReview={handleDeleteReview}
            onRefreshReviews={handleRefreshReviews}
            currentUserEmail={currentUser?.email}
            currentUserId={currentUser?.id}
          />
          </Suspense>
        )}
      </AnimatePresence>
    </div>
  );
}
