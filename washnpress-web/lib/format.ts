// Money is stored in paise everywhere and shown in rupees, formatted the Indian way.
export function rupees(paise: number): string {
  return "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
