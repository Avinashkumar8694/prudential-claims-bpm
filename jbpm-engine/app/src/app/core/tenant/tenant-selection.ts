// Which workspace (tenant) the signed-in user is currently working in. It is sent on every API call as
// `x-tenant-id`. Kept in localStorage keyed to the user's `sub`, so another account signing in on the same
// browser never inherits a workspace it does not belong to.

const STORAGE_KEY = 'zero.workspace.v1';

let selectedTenantId: string | null = null;
let ownerSub: string | null = null;
const listeners = new Set<() => void>();

export function subscribeTenantSelection(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSelectedTenantId(): string | null {
  return selectedTenantId;
}

/** The workspace this browser last used for `sub` (null when none, or when it was a different user). */
export function readStoredTenantId(sub: string | null): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sub?: unknown; id?: unknown };
    if (typeof parsed.id === 'string' && parsed.id && parsed.sub === (sub ?? 'unknown')) {
      return parsed.id;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

/** Bind the selection to a user and restore their last workspace. Call after sign-in. */
export function initTenantSelection(sub: string | null): string | null {
  ownerSub = sub;
  selectedTenantId = readStoredTenantId(sub);
  notify();
  return selectedTenantId;
}

export function setSelectedTenantId(tenantId: string | null): void {
  selectedTenantId = tenantId;
  if (tenantId) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sub: ownerSub ?? 'unknown', id: tenantId }));
    } catch {}
  } else {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
  notify();
}

/** Forget the in-memory selection (sign-out). The stored preference stays for the user's next sign-in. */
export function resetTenantSelection(): void {
  selectedTenantId = null;
  ownerSub = null;
  notify();
}

function notify(): void {
  listeners.forEach((listener) => listener());
}
