import { formatRating } from '../../lib/ratings';
import React from 'react';
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
} from 'lucide-react';
import { motion } from 'motion/react';
import { UPC_APP_SHORT_NAME } from '../../config/upc';

interface MobileServicesViewProps {
  teachers: Teacher[];
  userPoints: number;
  onOpenSearch: (query?: string) => void;
  onOpenReview: (teacher?: Teacher) => void;
  onOpenPoints: () => void;
  onOpenCollegeList: () => void;
  onSelectTeacher: (teacher: Teacher) => void;
}

export const MobileServicesView: React.FC<MobileServicesViewProps> = ({
  teachers,
  userPoints,
  onOpenSearch,
  onOpenReview,
  onOpenPoints,
  onOpenCollegeList,
  onSelectTeacher,
}) => {
  const featuredTeachers = teachers.slice(0, 4);

  return (
    <div id="mobile-services-view" className="w-full px-4 pt-3 pb-24 space-y-4">
      <div className="bg-gradient-to-r from-blue-900 to-blue-800 text-white p-4 rounded-3xl shadow-sm space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold">{UPC_APP_SHORT_NAME} · 功能中心</span>
            <span className="px-2 py-0.5 rounded-full bg-white/20 text-3xs font-semibold">
              课堂反馈
            </span>
          </div>
          <motion.div
            onClick={onOpenPoints}
            whileTap={{ scale: 0.9 }}
            className="flex items-center gap-1 bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded-full text-xs cursor-pointer transition-colors"
          >
            <Coins className="w-3.5 h-3.5 text-amber-300" />
            <span className="font-bold">{userPoints}</span>
            <span className="text-3xs">分</span>
          </motion.div>
        </div>
        <p className="text-2xs text-blue-100">
          教师库检索 · 六维课堂评价 · 院系导航
        </p>
      </div>

      <div className="bg-white p-3.5 rounded-3xl border border-gray-100 shadow-2xs space-y-2">
        <span className="text-2xs font-bold text-gray-400 px-1 uppercase tracking-wider block">
          核心功能
        </span>
        <div className="grid grid-cols-4 gap-1">
          <motion.button
            onClick={() => onOpenSearch()}
            whileHover={{ scale: 1.06, y: -2 }}
            whileTap={{ scale: 0.88 }}
            className="flex flex-col items-center gap-1 p-1 rounded-2xl transition-all group cursor-pointer"
          >
            <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-800 flex items-center justify-center group-hover:bg-blue-900 group-hover:text-white group-hover:shadow-md group-hover:shadow-blue-200 transition-all">
              <Search className="w-5 h-5 stroke-[1.8]" />
            </div>
            <span className="text-2xs font-medium text-gray-700">找老师</span>
          </motion.button>

          <motion.button
            onClick={() => onOpenReview()}
            whileHover={{ scale: 1.06, y: -2 }}
            whileTap={{ scale: 0.88 }}
            className="flex flex-col items-center gap-1 p-1 rounded-2xl transition-all group cursor-pointer"
          >
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white group-hover:shadow-md group-hover:shadow-emerald-200 transition-all">
              <PenLine className="w-5 h-5 stroke-[1.8]" />
            </div>
            <span className="text-2xs font-medium text-gray-700">写评价</span>
          </motion.button>

          <motion.button
            onClick={onOpenCollegeList}
            whileHover={{ scale: 1.06, y: -2 }}
            whileTap={{ scale: 0.88 }}
            className="flex flex-col items-center gap-1 p-1 rounded-2xl transition-all group cursor-pointer"
          >
            <div className="w-11 h-11 rounded-2xl bg-purple-50 text-purple-700 flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white group-hover:shadow-md group-hover:shadow-purple-200 transition-all">
              <LayoutGrid className="w-5 h-5 stroke-[1.8]" />
            </div>
            <span className="text-2xs font-medium text-gray-700">院系库</span>
          </motion.button>

          <motion.button
            onClick={onOpenPoints}
            whileHover={{ scale: 1.06, y: -2 }}
            whileTap={{ scale: 0.88 }}
            className="flex flex-col items-center gap-1 p-1 rounded-2xl transition-all group cursor-pointer"
          >
            <div className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-700 flex items-center justify-center group-hover:bg-rose-600 group-hover:text-white group-hover:shadow-md group-hover:shadow-rose-200 transition-all">
              <Coins className="w-5 h-5 stroke-[1.8]" />
            </div>
            <span className="text-2xs font-medium text-gray-700">积分中心</span>
          </motion.button>
        </div>
      </div>

      <div className="bg-white p-3.5 rounded-3xl border border-gray-100 shadow-2xs space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-blue-800" />
            <h3 className="text-xs font-bold text-gray-900 tracking-wider">已导入教师</h3>
          </div>
          <button
            onClick={() => onOpenSearch()}
            className="text-2xs text-gray-400 hover:text-blue-800 flex items-center gap-0.5 transition-colors font-medium"
          >
            查看全部 <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {featuredTeachers.length === 0 ? (
          <div className="py-8 text-center text-2xs text-gray-400 leading-relaxed">
            教师数据尚未导入。
            <br />
            管理员完成学院与教师主数据导入后，这里会显示可核对的数据。
          </div>
        ) : (
          <div className="space-y-2">
            {featuredTeachers.map((teacher) => (
              <motion.div
                key={teacher.id}
                onClick={() => onSelectTeacher(teacher)}
                whileTap={{ scale: 0.98 }}
                className="p-3 bg-gray-50/70 hover:bg-gray-100/70 rounded-2xl border border-gray-100 shadow-2xs transition-all cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-800 font-bold flex items-center justify-center text-xs group-hover:bg-blue-900 group-hover:text-white transition-colors shrink-0">
                    {teacher.name.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-gray-900 text-xs group-hover:text-blue-800 transition-colors">
                        {teacher.name}
                      </span>
                      <span className="text-3xs text-gray-500">
                        {teacher.identityKind === 'timetable_unit_name'
                          ? '课表来源身份'
                          : (teacher.title || '职称待核实')}
                      </span>
                      <span className="text-4xs px-1 py-0.2 bg-gray-200 text-gray-600 rounded">
                        {teacher.identityKind === 'timetable_unit_name' ? '课表·' : ''}
                        {teacher.college.replace('学院', '')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-2xs text-gray-500 mt-0.5">
                      <span>{teacher.courses[0] || '课程待补充'}</span>
                      <span>·</span>
                      <span className="text-emerald-600 font-medium">
                        给分 {formatRating(teacher.dimensions.gradingLeniency, '分')}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 font-bold text-amber-600 text-xs">
                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  <span>{formatRating(teacher.overallScore)}</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-gray-50/80 p-3.5 rounded-2xl border border-gray-100 text-xs text-gray-500 space-y-1.5">
        <div className="flex items-center gap-1.5 font-bold text-gray-700">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>石大公益社区公约</span>
        </div>
        <p className="text-2xs leading-relaxed text-gray-500">
          写评价获赠 +20 积分奖励，结构化查老师永久免费。请基于真实上课体验，拒绝注水与人身攻击。
        </p>
      </div>
    </div>
  );
};
