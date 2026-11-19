const DYNAMIC_IMPORT_ERROR_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

const RELOAD_GUARD_KEY = 'admin_dynamic_import_reload_guard';
const RELOAD_GUARD_TTL = 10_000;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || '');
}

export function isDynamicImportError(error: unknown) {
  return DYNAMIC_IMPORT_ERROR_RE.test(getErrorMessage(error));
}

export function reloadForDynamicImportError(targetPath?: string) {
  if (typeof window === 'undefined') {
    return false;
  }

  const targetUrl = targetPath
    ? new URL(targetPath, window.location.origin).toString()
    : window.location.href;

  try {
    const raw = sessionStorage.getItem(RELOAD_GUARD_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const lastTarget = String(parsed?.target || '');
      const lastAt = Number(parsed?.at || 0);
      if (lastTarget === targetUrl && Date.now() - lastAt < RELOAD_GUARD_TTL) {
        sessionStorage.removeItem(RELOAD_GUARD_KEY);
        return false;
      }
    }

    sessionStorage.setItem(
      RELOAD_GUARD_KEY,
      JSON.stringify({
        target: targetUrl,
        at: Date.now(),
      }),
    );
  } catch {
    // Ignore sessionStorage failures and still attempt a reload.
  }

  window.location.assign(targetUrl);
  return true;
}

export function clearDynamicImportReloadGuard() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    sessionStorage.removeItem(RELOAD_GUARD_KEY);
  } catch {
    // Ignore sessionStorage failures.
  }
}
