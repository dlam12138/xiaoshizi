import collegeData from '../../data/upc/colleges.json';

export const UPC_SCHOOL_NAME = '中国石油大学（华东）';
export const UPC_SCHOOL_SHORT_NAME = '石大';
export const UPC_APP_NAME = '小石子';
export const UPC_APP_SHORT_NAME = '小石子';
export const UPC_SITE_DESCRIPTION =
  '中国石油大学（华东）课堂反馈平台：检索教师、查看六维课堂反馈、提交经审核后公开的评价。';

export type UpcCollege = { code: string; name: string; aliases: string[] };

export const UPC_CAMPUSES = collegeData.campuses as readonly string[];
export type UpcCampus = (typeof UPC_CAMPUSES)[number];

export const UPC_COLLEGES: UpcCollege[] = collegeData.colleges;
export const UPC_COLLEGE_NAMES = UPC_COLLEGES.map((college) => college.name);
export const UPC_COLLEGE_SOURCE = collegeData.source;
export const UPC_COLLEGE_RETRIEVED_ON = collegeData.retrievedOn;

export function findUpcCollege(value?: string | null): UpcCollege | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return UPC_COLLEGES.find(
    (college) =>
      college.code === text ||
      college.name === text ||
      college.aliases.includes(text),
  );
}

// Phase-one feature boundary. Timetable recommendations, notices and unverified
// guides are intentionally disabled until their UPC data sources are verified.
export const UPC_FEATURES = {
  timetableRecommendation: false,
  notices: false,
  experienceGuides: false,
  aiAssistant: false,
} as const;
