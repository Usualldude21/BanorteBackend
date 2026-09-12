interface Decimal { value: bigint; scale: number }

function parse(value: string): Decimal {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error("Decimal inválido");
  const fraction = match[3] ?? "";
  const integer = BigInt(`${match[1] ?? ""}${match[2]}${fraction}`);
  return { value: integer, scale: fraction.length };
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.value * 10n ** BigInt(scale - a.scale), b.value * 10n ** BigInt(scale - b.scale), scale];
}

function format(value: bigint, scale: number): string {
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, "0");
  if (scale === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

export function subtractDecimal(current: string, previous: string): string {
  const [a, b, scale] = align(parse(current), parse(previous));
  return format(a - b, scale);
}

export function addDecimal(left: string, right: string): string {
  const [a, b, scale] = align(parse(left), parse(right));
  return format(a + b, scale);
}

export function compareDecimal(a: string, b: string): number {
  const [left, right] = align(parse(a), parse(b));
  return left === right ? 0 : left > right ? 1 : -1;
}

export function percentageChange(current: string, previous: string): string | null {
  const [a, b] = align(parse(current), parse(previous));
  if (b === 0n) return null;
  const precision = 4;
  const numerator = (a - b) * 100n * 10n ** BigInt(precision);
  const divisor = b < 0n ? -b : b;
  const quotient = numerator / divisor;
  const remainder = numerator % divisor;
  const rounded = (remainder < 0n ? -remainder : remainder) * 2n >= divisor
    ? quotient + (numerator < 0n ? -1n : 1n)
    : quotient;
  return format(rounded, precision);
}
