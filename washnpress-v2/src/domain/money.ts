// Money is always stored and moved as an integer number of paise. Never floats.
export type Paise = number;

export function assertPaise(value: Paise): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Amount must be a non-negative integer number of paise, received ${value}`);
  }
}

export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees) || rupees < 0) {
    throw new Error(`Rupee amount must be a non-negative finite number, received ${rupees}`);
  }
  return Math.round(rupees * 100);
}

export function paiseToRupees(value: Paise): number {
  assertPaise(value);
  return value / 100;
}

export function addPaise(a: Paise, b: Paise): Paise {
  assertPaise(a);
  assertPaise(b);
  return a + b;
}

export function formatInr(value: Paise): string {
  assertPaise(value);
  return `₹${(value / 100).toFixed(2)}`;
}
