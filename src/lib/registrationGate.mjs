// Registration gate for preview deployments. Keep this dependency-free so the
// Node test runner can import it directly (same pattern as supabaseUrl.mjs).
//
// VITE_REGISTRATION_OPEN defaults to open so existing builds keep working.
// A pre-release build sets it to "false"; the real enforcement is also
// Supabase Auth `disable_signup`, because a hidden button is not a control.

export function isRegistrationOpen(value) {
  if (value === undefined || value === null || value === '') return true;
  return String(value).trim().toLowerCase() !== 'false';
}

export function registrationUiState({ registrationOpen = true, preRelease = false } = {}) {
  const canRegister = Boolean(registrationOpen);
  return {
    canRegister,
    showRegisterTab: canRegister,
    fallbackMode: 'login',
    banner: canRegister
      ? null
      : '预发布站点：注册暂未开放，仅限受邀账号登录。',
    headerBadge: preRelease && !canRegister ? '预发布' : null,
  };
}
