import { Account } from "./accounts";
export function walletAccount(residentId: string): string { return `${Account.ResidentWallet}:${residentId}`; }
