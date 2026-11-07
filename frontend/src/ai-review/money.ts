export function formatBalanceUsd(value: string): string {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "$0.00";
  }
  const cents = Math.round(Number(`${parsed}e2`));
  if (cents <= 0) {
    return "$0.00";
  }
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatReviewCostUsd(value: string): string {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "$0.00";
  }
  if (parsed < 0.01) {
    return "<$0.01";
  }
  const cents = Math.round(Number(`${parsed}e2`));
  return `$${(cents / 100).toFixed(2)}`;
}
