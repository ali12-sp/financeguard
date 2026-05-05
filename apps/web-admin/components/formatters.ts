function parseDateLike(value: string) {
  return value.includes('T') ? new Date(value) : new Date(`${value}T00:00:00`);
}

const moneyFormatter = new Intl.NumberFormat('en-PK', {
  style: 'currency',
  currency: 'PKR',
  maximumFractionDigits: 0
});

export function formatCurrency(value: number) {
  return moneyFormatter.format(value);
}

export function formatDate(value?: string | null) {
  if (!value) return '-';
  return parseDateLike(value).toLocaleDateString('en-PK', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

export function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return parseDateLike(value).toLocaleString('en-PK', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
