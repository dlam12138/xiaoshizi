import React from 'react';
import { RATING_DIMENSIONS, isRating } from '../lib/ratings';
import type { TeacherRatingDimensions } from '../types';

export function RatingRadar({ dimensions }: { dimensions: Partial<TeacherRatingDimensions> }) {
  const centerX = 180;
  const centerY = 158;
  const radius = 92;
  const point = (index: number, valueRadius: number) => {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    return [centerX + Math.cos(angle) * valueRadius, centerY + Math.sin(angle) * valueRadius];
  };
  const polygon = (valueRadius: number) => RATING_DIMENSIONS.map((_, i) => point(i, valueRadius).join(',')).join(' ');
  const complete = RATING_DIMENSIONS.every(d => isRating(dimensions[d.key]));
  const hasAny = RATING_DIMENSIONS.some(d => isRating(dimensions[d.key]));
  const accessibleValues = RATING_DIMENSIONS
    .map(d => `${d.label}：${isRating(dimensions[d.key]) ? dimensions[d.key]!.toFixed(1) : '暂无数据'}`)
    .join('，');
  return <div className="rating-radar rounded-2xl border border-indigo-100 bg-indigo-50/30 px-1 pt-1 pb-2 sm:px-2">
    <svg
      viewBox="0 0 360 320"
      className="block w-full max-w-md mx-auto overflow-visible"
      role="img"
      aria-label={`六维课堂评分图。${accessibleValues}`}
    >
      {[1, 2, 3, 4, 5].map(level => (
        <polygon
          key={level}
          points={polygon(level * (radius / 5))}
          fill={level === 5 ? '#eef2ff' : 'none'}
          stroke="#c7d2fe"
          strokeWidth="1"
        />
      ))}
      {RATING_DIMENSIONS.map((d, i) => {
        const [x, y] = point(i, radius);
        return <line key={d.key} x1={centerX} y1={centerY} x2={x} y2={y} stroke="#c7d2fe" />;
      })}
      {complete && (
        <polygon
          points={RATING_DIMENSIONS.map((d, i) => point(i, (dimensions[d.key]! / 5) * radius).join(',')).join(' ')}
          fill="#6366f1"
          fillOpacity="0.22"
          stroke="#4f46e5"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      )}
      {RATING_DIMENSIONS.map((d, i) => {
        const value = dimensions[d.key];
        const [x, y] = point(i, radius + 30);
        const [px, py] = point(i, isRating(value) ? (value / 5) * radius : 0);
        return <g key={d.key}>
          {isRating(value) && <circle cx={px} cy={py} r="3.5" fill="#4f46e5" />}
          <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#334155" fontSize="11" fontWeight="600">
            {d.label}
          </text>
        </g>;
      })}
    </svg>
    <p className="text-center text-xs text-slate-500">
      {complete ? '六维评分形状' : hasAny ? '部分维度暂无数据' : '暂无数据'}
    </p>
  </div>;
}
