import { formatRating } from '../../lib/ratings';
import { isRegistrationOpen } from '../../lib/registrationGate.mjs';

const registrationOpen = isRegistrationOpen(import.meta.env.VITE_REGISTRATION_OPEN);
import React, { useState } from 'react';
import { Teacher } from '../../types';
import {
  Search,
  PenLine,
  LayoutGrid,
  Coins,
  ChevronRight,
  Star,
  TrendingUp,
  ShieldCheck,
  Database,
} from 'lucide-react';
import { UPC_APP_SHORT_NAME } from '../../config/upc';

interface DesktopQuarkHomeProps {
  currentUser?: any | null;
  onOpenAuth?: (mode?: 'login' | 'register') => void;
  teachers: Teacher[];
  teacherTotal?: number;
  userPoints: number;
  onOpenSearch: (query?: string) => void;
  onOpenReview: (teacher?: Teacher) => void;
  onOpenPoints: () => void;
  onOpenCollegeList: () => void;
  onSelectTeacher: (teacher: Teacher) => void;
}

export const DesktopQuarkHome: React.FC<DesktopQuarkHomeProps> = ({
  currentUser,
  onOpenAuth,
  teachers,
  teacherTotal,
  userPoints,
  onOpenSearch,
  onOpenReview,
  onOpenPoints,
  onOpenCollegeList,
  onSelectTeacher,
}) => {
  const [query, setQuery] = useState('');
  const isLoggedIn = Boolean(currentUser);
  const featuredTeachers = teachers.slice(0, 5);

  const handleInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    onOpenSearch(query.trim());
    setQuery('');
  };

  return (
    <div id="desktop-quark-home" className="w-full max-w-5xl mx-auto pt-2 pb-16 flex flex-col items-center">
      <div className="flex flex-col items-center justify-center my-6 select-none">
        <div className="flex items-center gap-2.5">
          <h1 className="text-5xl font-extrabold tracking-tight text-gray-950 font-sans">
            {UPC_APP_SHORT_NAME}
          </h1>
          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-800 border border-blue-100">
            UPC
          </span>
        </div>
      </div>

      <div className="w-full max-w-3xl bg-white rounded-3xl border border-gray-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.06)] p-5 mb-8 transition-all hover:shadow-[0_10px_35px_rgb(0,0,0,0.09)]">
        <form onSubmit={handleInputSubmit} className="space-y-3.5">
          <div className="relative">
            <input
              id="desktop-search-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入教师姓名、学院或课程名称搜索老师（如：高数、张老师）"
              className="w-full px-2 py-1.5 text-base text-gray-900 placeholder:text-gray-400 focus:outline-hidden bg-transparent"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-gray-100/80">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-blue-900 text-white shadow-xs">
                <Search className="w-3.5 h-3.5" />
                搜老师 (免费)
              </span>
            </div>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <Search className="w-3.5 h-3.5" />
              <span>搜索</span>
            </button>
          </div>
        </form>

        <div className="flex flex-wrap gap-2 pt-3 mt-2 border-t border-gray-50">
          <span className="text-2xs text-gray-400 flex items-center py-1">热门搜索：</span>
          {['高等数学', '不点名', '给分大方', '课程评价'].map((prompt) => (
            <button
              key={prompt}
              onClick={() => onOpenSearch(prompt)}
              className="text-xs px-3 py-1 bg-gray-50 hover:bg-blue-50 hover:text-blue-800 text-gray-600 rounded-full transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full grid grid-cols-4 gap-3.5 mb-4">
        <button
          onClick={() => onOpenSearch()}
          className="flex items-center gap-3 p-3.5 bg-white rounded-2xl border border-gray-100 hover:border-blue-200 hover:shadow-xs active:scale-98 transition-all group text-left"
        >
          <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-800 flex items-center justify-center shrink-0 group-hover:bg-blue-900 group-hover:text-white transition-colors">
            <Search className="w-5 h-5 stroke-[1.8]" />
          </div>
          <div>
            <span className="text-sm font-bold text-gray-800 group-hover:text-blue-800 block">找老师</span>
            <span className="text-2xs text-gray-400 mt-0.5 block">结构化精准检索</span>
          </div>
        </button>

        <button
          onClick={() => onOpenReview()}
          className="flex items-center gap-3 p-3.5 bg-white rounded-2xl border border-gray-100 hover:border-emerald-200 hover:shadow-xs active:scale-98 transition-all group text-left"
        >
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
            <PenLine className="w-5 h-5 stroke-[1.8]" />
          </div>
          <div>
            <span className="text-sm font-bold text-gray-800 group-hover:text-emerald-600 block">写评价</span>
            <span className="text-2xs text-gray-400 mt-0.5 block">审核通过 +20 积分</span>
          </div>
        </button>

        <button
          onClick={onOpenCollegeList}
          className="flex items-center gap-3 p-3.5 bg-white rounded-2xl border border-gray-100 hover:border-purple-200 hover:shadow-xs active:scale-98 transition-all group text-left"
        >
          <div className="w-11 h-11 rounded-2xl bg-purple-50 text-purple-700 flex items-center justify-center shrink-0 group-hover:bg-purple-600 group-hover:text-white transition-colors">
            <LayoutGrid className="w-5 h-5 stroke-[1.8]" />
          </div>
          <div>
            <span className="text-sm font-bold text-gray-800 group-hover:text-purple-600 block">院系库</span>
            <span className="text-2xs text-gray-400 mt-0.5 block">按学院浏览教师</span>
          </div>
        </button>

        <button
          onClick={onOpenPoints}
          className="flex items-center gap-3 p-3.5 bg-white rounded-2xl border border-gray-100 hover:border-rose-200 hover:shadow-xs active:scale-98 transition-all group text-left"
        >
          <div className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-700 flex items-center justify-center shrink-0 group-hover:bg-rose-600 group-hover:text-white transition-colors">
            <Coins className="w-5 h-5 stroke-[1.8]" />
          </div>
          <div>
            <span className="text-sm font-bold text-gray-800 group-hover:text-rose-600 block">积分中心</span>
            <span className="text-2xs text-gray-400 mt-0.5 block">每日签到 · 流水明细</span>
          </div>
        </button>
      </div>

      <div className="w-full grid grid-cols-12 gap-6">
        <div className="col-span-7 space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-blue-50 text-blue-800 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5" />
              </div>
              <h3 className="text-sm font-bold text-gray-900 tracking-tight">已导入教师</h3>
            </div>
            <button
              onClick={() => onOpenSearch()}
              className="text-xs text-gray-400 hover:text-blue-800 flex items-center gap-0.5 transition-colors font-medium"
            >
              进入教师库 ({teacherTotal ?? teachers.length}) <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {featuredTeachers.length === 0 ? (
            <div className="p-8 bg-white rounded-2xl border border-dashed border-gray-200 text-center space-y-2">
              <Database className="w-6 h-6 text-gray-300 mx-auto" />
              <p className="text-sm font-semibold text-gray-700">教师数据尚未导入</p>
              <p className="text-xs text-gray-400 leading-relaxed max-w-sm mx-auto">
                为遵守“不伪造 UPC 数据”的约束，页面不会展示示例教师。
                管理员导入学院、教师与开课关系后，教师库和榜单才会出现。
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {featuredTeachers.map((teacher) => (
                <div
                  key={teacher.id}
                  onClick={() => onSelectTeacher(teacher)}
                  className="p-4 bg-white rounded-2xl border border-gray-100 hover:border-blue-200 shadow-2xs hover:shadow-xs transition-all cursor-pointer flex items-center justify-between group"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-800 font-bold flex items-center justify-center text-sm group-hover:bg-blue-900 group-hover:text-white transition-colors shrink-0">
                      {teacher.name.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 text-base group-hover:text-blue-800 transition-colors">
                          {teacher.name}
                        </span>
                        <span className="text-xs text-gray-500 font-medium">
                          {teacher.identityKind === 'timetable_unit_name'
                            ? '课表来源身份'
                            : (teacher.title || '职称待核实')}
                        </span>
                        <span className="text-2xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-md">
                          {teacher.identityKind === 'timetable_unit_name' ? '课表·' : ''}
                          {teacher.college.replace('学院', '')}
                        </span>
                        {teacher.isTeachingThisTerm && (
                          <span className="text-3xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md border border-emerald-200">
                            本学期开课
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                        <span className="text-gray-700 font-medium">{teacher.courses[0] || '课程待补充'}</span>
                        <span>·</span>
                        <span className="text-emerald-600 font-medium">给分宽松 {formatRating(teacher.dimensions.gradingLeniency, '分')}</span>
                        <span>·</span>
                        <span>考勤宽松度 {formatRating(teacher.dimensions.attendanceStrictness, '分')}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1 font-bold text-amber-600 text-base">
                      <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                      <span>{formatRating(teacher.overallScore)}</span>
                    </div>
                    <span className="text-2xs text-gray-400">{teacher.reviewCount} 条评价</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="col-span-5 space-y-4">
          <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-2xs space-y-3">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-800" />
              <h4 className="text-sm font-bold text-gray-900">数据覆盖说明</h4>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              当前展示的是已经导入并核对过的教师与开课关系，不代表全校完整教师库。
              没有评价的教师显示“暂无数据”，不会用默认分数填充。
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-2xs text-gray-400 block">已导入教师</span>
                <span className="text-lg font-bold text-gray-900">{teacherTotal ?? teachers.length}</span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span className="text-2xs text-gray-400 block">覆盖范围</span>
                <span className="text-sm font-bold text-gray-900">分批导入</span>
              </div>
            </div>
          </div>

          <div className="p-4 bg-white rounded-3xl border border-gray-100 text-xs text-gray-500 space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-gray-800">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>石大公益社区共建公约</span>
            </div>
            <p className="text-2xs leading-relaxed text-gray-600">
              结构化查询教师永久免费。提交真实上课评价通过审核可获 <strong className="text-amber-600">+20 积分</strong>。
              请基于真实体验，严禁注水与人身攻击。
            </p>
          </div>

          {!isLoggedIn && (
            <button
              onClick={() => onOpenAuth?.(registrationOpen ? 'register' : 'login')}
              className="w-full p-4 bg-gradient-to-r from-blue-900 to-blue-800 text-white rounded-3xl text-left shadow-md shadow-blue-200/60 hover:shadow-lg transition-all"
            >
              <span className="text-sm font-bold block">{registrationOpen ? '注册参与课堂反馈' : '登录参与课堂反馈'}</span>
              <span className="text-2xs text-blue-100 mt-1 block">
                {registrationOpen
                  ? '新用户赠送 100 积分，可签到和评价获取更多积分'
                  : '使用账号登录后可提交课堂反馈；预发布阶段注册暂未开放'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
