// Chart of accounts for the double-entry ledger.
// Convention: a resident wallet is a liability we owe the resident, so a credit
// increases the wallet balance and a debit spends from it.
export enum Account {
  ResidentWallet = "resident_wallet",
  GatewayClearing = "gateway_clearing",
  SubscriptionRevenue = "subscription_revenue",
  AddonRevenue = "addon_revenue",
  RefundsPayable = "refunds_payable",
  // GST collected on a sale is money held on behalf of the tax authority, not
  // revenue. It is credited here when a taxed charge settles and debited back when
  // that charge is refunded, so the platform can always say what tax it is holding
  // separately from what it earned.
  TaxPayable = "tax_payable",
}
