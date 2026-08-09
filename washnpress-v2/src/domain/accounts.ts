// Chart of accounts for the double-entry ledger.
// Convention: a resident wallet is a liability we owe the resident, so a credit
// increases the wallet balance and a debit spends from it.
export enum Account {
  ResidentWallet = "resident_wallet",
  GatewayClearing = "gateway_clearing",
  SubscriptionRevenue = "subscription_revenue",
  AddonRevenue = "addon_revenue",
  RefundsPayable = "refunds_payable",
}
