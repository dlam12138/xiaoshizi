import React, { useState } from 'react';
import { Search, Coins, PenLine } from 'lucide-react';
import { motion } from 'motion/react';
import { UPC_APP_SHORT_NAME, UPC_SCHOOL_NAME } from '../../config/upc';

interface MobileQuarkHomeProps {
  currentUser?: any | null;
  onOpenAuth?: (mode?: 'login' | 'register') => void;
  userPoints: number;
  onOpenSearch: (query?: string) => void;
  onOpenPoints: () => void;
  onOpenReview: () => void;
}

export const MobileQuarkHome: React.FC<MobileQuarkHomeProps> = ({
  currentUser,
  onOpenAuth,
  userPoints,
  onOpenSearch,
  onOpenPoints,
  onOpenReview,
}) => {
  const [query, setQuery] = useState('');
  const isLoggedIn = Boolean(currentUser);

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    onOpenSearch(query.trim());
    setQuery('');
  };

  return (
    <div
      id="mobile-quark-home"
      className="w-full min-h-[75vh] px-4 pt-4 pb-20 flex flex-col justify-between items-center"
    >
      <div className="w-full flex items-center justify-between text-xs text-gray-400 mb-6">
        <span className="font-medium tracking-tight text-gray-500">{UPC_SCHOOL_NAME} · 课堂反馈</span>

        {isLoggedIn ? (
          <motion.div
            onClick={onOpenPoints}
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.03 }}
            className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full border border-amber-200/80 cursor-pointer transition-colors shadow-2xs"
          >
            <Coins className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-bold">{userPoints}</span>
            <span className="text-3xs text-amber-700">积分</span>
          </motion.div>
        ) : (
          <button
            onClick={() => onOpenAuth?.('login')}
            className="flex items-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-800 px-3 py-1 rounded-full border border-blue-200/80 text-xs font-bold transition-colors shadow-2xs"
          >
            <span>登录 / 注册</span>
          </button>
        )}
      </div>

      <div className="w-full flex-1 flex flex-col items-center justify-center -mt-6">
        <div className="flex flex-col items-center justify-center mb-6 select-none">
          <div className="flex items-center gap-2">
            <h1 className="text-4xl font-extrabold tracking-tight text-gray-950 font-sans">
              {UPC_APP_SHORT_NAME}
            </h1>
            <span className="px-2 py-0.5 rounded-full text-3xs font-bold bg-blue-50 text-blue-800 border border-blue-100">
              UPC
            </span>
          </div>
        </div>

        <div className="w-full bg-white rounded-3xl border border-gray-200/80 shadow-[0_6px_25px_rgb(0,0,0,0.06)] p-3.5 transition-all">
          <form onSubmit={handleInputSubmit} className="space-y-3">
            <div className="relative">
              <input
                id="mobile-search-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="输入教师姓名、学院或课程搜索老师…"
                className="w-full px-2 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-hidden bg-transparent"
              />
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-gray-100/80">
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-900 text-white">
                <Search className="w-3 h-3" />
                <span>搜老师</span>
              </div>

              <motion.button
                type="submit"
                whileTap={{ scale: 0.9 }}
                whileHover={{ scale: 1.05 }}
                className="p-1.5 rounded-full bg-blue-900 text-white shadow-xs"
                aria-label="搜索教师"
              >
                <Search className="w-4 h-4" />
              </motion.button>
            </div>
          </form>

          <div className="flex flex-wrap gap-1.5 pt-2.5 mt-2 border-t border-gray-50">
            {['高等数学', '不点名', '给分大方'].map((prompt) => (
              <motion.button
                key={prompt}
                whileTap={{ scale: 0.93 }}
                onClick={() => onOpenSearch(prompt)}
                className="text-2xs px-2.5 py-1 bg-gray-50 hover:bg-blue-50 hover:text-blue-800 text-gray-600 rounded-full transition-colors"
              >
                {prompt}
              </motion.button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex justify-center">
          <motion.button
            type="button"
            id="home-quick-review-btn"
            whileTap={{ scale: 0.94 }}
            whileHover={{ scale: 1.03 }}
            onClick={onOpenReview}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-900 to-blue-800 text-white rounded-full shadow-md shadow-blue-200/70 hover:shadow-lg hover:shadow-blue-300/80 transition-all text-xs font-semibold"
          >
            <PenLine className="w-3.5 h-3.5" />
            <span>快速评价</span>
            <span className="text-3xs bg-white/20 px-1.5 py-0.5 rounded-full text-blue-50 font-normal">
              +20积分
            </span>
          </motion.button>
        </div>
      </div>

      <div className="text-2xs text-gray-400 text-center pb-2 select-none">
        底部点击【服务】进入教师库、评价与院系导航
      </div>
    </div>
  );
};
