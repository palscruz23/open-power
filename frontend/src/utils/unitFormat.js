const numberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

function formatNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return numberFormatter.format(Number.isFinite(numericValue) ? numericValue : fallback);
}

function formatScaledBaseUnit(baseValue, unit) {
  const absValue = Math.abs(baseValue);

  if (absValue > 1_000_000) {
    return `${formatNumber(baseValue / 1_000_000)} M${unit}`;
  }
  if (absValue > 1_000) {
    return `${formatNumber(baseValue / 1_000)} k${unit}`;
  }
  return `${formatNumber(baseValue)} ${unit}`;
}

export function formatCurrentFromKa(value, fallback = 0) {
  const numericKa = Number(value ?? fallback);
  const amps = Number.isFinite(numericKa) ? numericKa * 1_000 : fallback * 1_000;
  return formatScaledBaseUnit(amps, 'A');
}

export function formatVoltageFromKv(value, fallback = 0) {
  const numericKv = Number(value ?? fallback);
  const volts = Number.isFinite(numericKv) ? numericKv * 1_000 : fallback * 1_000;
  return formatScaledBaseUnit(volts, 'V');
}
