// Shared helpers for document stores.

// Shallow-deep containment match, same semantics as Postgres `data @> where`.
export function matches(doc, where) {
  for (const [k, v] of Object.entries(where || {})) {
    const dv = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!dv || typeof dv !== 'object' || !matches(dv, v)) return false;
    } else if (Array.isArray(v)) {
      if (!Array.isArray(dv) || !v.every((x) => dv.includes(x))) return false;
    } else if (dv !== v) {
      return false;
    }
  }
  return true;
}

export function sortDocs(docs, orderBy = 'createdAt') {
  const desc = orderBy.startsWith('-');
  const key = desc ? orderBy.slice(1) : orderBy;
  return docs.sort((a, b) => {
    const av = a[key] ?? '';
    const bv = b[key] ?? '';
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });
}

export function stamp(doc, prev) {
  const now = new Date().toISOString();
  return {
    ...doc,
    createdAt: prev?.createdAt || doc.createdAt || now,
    updatedAt: now,
  };
}
