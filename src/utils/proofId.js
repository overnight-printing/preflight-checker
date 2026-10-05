export function normalizeProofId(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function proofIdForFilename(value) {
  return normalizeProofId(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'proof';
}
