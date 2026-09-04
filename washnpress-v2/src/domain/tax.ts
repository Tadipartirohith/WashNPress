// GST, worked out in one place.
//
// The platform can charge Goods and Services Tax on a sale. The rate is
// configuration, and tax is exclusive: a listed price is pre-tax, and the tax is
// added on top of it. An intra-state supply splits equally into Central and State
// GST — CGST and SGST — which is how the two halves appear on an Indian invoice, so
// they are computed here rather than left for each screen to halve the total itself.
//
// Everything is in paise and rounded once, at the end, so the two halves always add
// back to the whole and a total is never a rupee out from the sum of its lines.

export interface GstBreakdown {
  // Whether tax was actually applied. False leaves every figure zero, which is what
  // a deployment that has not switched GST on looks like.
  applied: boolean;
  ratePercent: number;
  // The pre-tax amount the tax was computed on.
  taxablePaise: number;
  // The whole tax, and its two statutory halves.
  taxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  // taxablePaise + taxPaise: what the customer actually pays.
  grossPaise: number;
}

export interface GstConfig {
  gstEnabled?: boolean;
  gstRatePercent?: number;
}

// The exclusive GST on a pre-tax amount. Returns a zero breakdown when GST is off,
// the rate is not positive, or there is nothing to tax, so a caller can always add
// `taxPaise` and split by `cgstPaise`/`sgstPaise` without checking first.
export function computeGst(taxablePaise: number, config: GstConfig): GstBreakdown {
  const ratePercent = Math.max(0, config.gstRatePercent ?? 0);
  const base = Math.max(0, Math.trunc(taxablePaise));
  const applied = Boolean(config.gstEnabled) && ratePercent > 0 && base > 0;
  if (!applied) {
    return { applied: false, ratePercent, taxablePaise: base, taxPaise: 0, cgstPaise: 0, sgstPaise: 0, grossPaise: base };
  }
  const taxPaise = Math.round((base * ratePercent) / 100);
  // CGST takes the floor of the half and SGST the remainder, so the two are equal
  // when the tax is even and differ by a single paisa when it is odd — never a
  // rounding that loses or invents a paisa against the total.
  const cgstPaise = Math.floor(taxPaise / 2);
  const sgstPaise = taxPaise - cgstPaise;
  return { applied: true, ratePercent, taxablePaise: base, taxPaise, cgstPaise, sgstPaise, grossPaise: base + taxPaise };
}
