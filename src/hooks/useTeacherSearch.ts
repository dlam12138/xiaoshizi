import { useMemo } from 'react';
import type { Teacher, TeacherQuery } from '../types';
import { supabaseService } from '../services/supabaseService';
import { usePagedQuery } from './usePagedQuery';

/**
 * Teacher search always reads the configured UPC database.
 *
 * `fallback` is kept in the signature for callers that still pass an in-memory
 * list, but it is never used as a data source: mock or old-school teachers must
 * not appear when the database is missing or empty.
 */
export function useTeacherSearch(_fallback: Teacher[], options: TeacherQuery, enabled = true) {
  const key = useMemo(() => JSON.stringify(options), [options]);
  const size = options.pageSize || 20;
  return usePagedQuery<Teacher>(
    key,
    (page, signal) => supabaseService.getTeachersPage({ ...options, page, pageSize: size }, signal),
    enabled,
    0,
    5 * 60 * 1000,
  );
}
