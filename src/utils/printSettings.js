export const DEFAULT_PRINT_REQUIREMENTS = { workflow: 'general', minDpi: 300, bleedPoints: 9, orderSize: null };

export function normalizePrintRequirements(requirements = {}) {
  const value = { ...DEFAULT_PRINT_REQUIREMENTS, ...requirements };
  if (!['general', 'pdfx4', 'legacy'].includes(value.workflow) ||
      !Number.isFinite(value.minDpi) || value.minDpi <= 0 ||
      !Number.isFinite(value.bleedPoints) || value.bleedPoints < 0 ||
      (value.orderSize !== null && !['width', 'height'].every(key => Number.isFinite(value.orderSize?.[key]) && value.orderSize[key] > 0))) {
    throw new Error('Choose a valid print workflow, minimum resolution, required bleed, and finished order size.');
  }
  return value;
}
