// What can be done to an account, and what it is called right now.
//
// The Users page offered one switch with two names: an operator got
// "Block"/"Unblock" and everybody else "Deactivate"/"Activate", both driving the
// same single flag. So there was no way to say "suspended for now" separately
// from "this account is finished", and which word an admin saw depended on the
// role of the person rather than on what they meant to do.
//
// Blocking is a hold — the account and everything on it stays, and unblocking
// lets the person straight back in. Deactivating retires the account. Both refuse
// a sign-in, and neither disturbs society or block assignments, so somebody who
// comes back comes back to the towers they had.

export type UserStatus = "active" | "on_leave" | "blocked" | "deleted";

export interface UserActionSubject {
  roles: string[];
  status: UserStatus | string;
}

export interface UserAction {
  key: "edit" | "block" | "unblock" | "deactivate" | "activate";
  label: string;
  // The status this action moves the account to. Absent for "edit", which opens a
  // form rather than changing anything.
  to?: "active" | "blocked" | "deleted";
  tone?: "danger" | "good";
  // Anything that is not simply opening a form is confirmed first.
  confirm?: { title: string; message: string; confirmLabel: string };
}

const named = (subject: UserActionSubject, name: string | null) => name?.trim() || "This account";

// An administrator is edited but never blocked or retired from this list. Locking
// the administrators out is not something a list of users should offer in passing,
// and one admin doing it to another is how a platform ends up with nobody who can
// undo it. Enforced at the backend too; this only stops it being offered.
export function mayChangeStatus(subject: UserActionSubject): boolean {
  return !subject.roles.includes("admin");
}

export function actionsFor(subject: UserActionSubject, fullName: string | null = null): UserAction[] {
  const who = named(subject, fullName);
  const actions: UserAction[] = [{ key: "edit", label: "Edit" }];
  if (!mayChangeStatus(subject)) return actions;

  // Retired accounts offer one way back and nothing else: blocking something that
  // is already out of service says nothing.
  if (subject.status === "deleted") {
    actions.push({
      key: "activate", label: "Activate", to: "active", tone: "good",
      confirm: {
        title: "Activate this account?",
        message: `${who} will be able to sign in again, with the society and blocks they had.`,
        confirmLabel: "Activate",
      },
    });
    return actions;
  }

  if (subject.status === "blocked") {
    actions.push({
      key: "unblock", label: "Unblock", to: "active", tone: "good",
      confirm: {
        title: "Unblock this account?",
        message: `${who} will be able to sign in again straight away.`,
        confirmLabel: "Unblock",
      },
    });
  } else {
    actions.push({
      key: "block", label: "Block", tone: "danger", to: "blocked",
      confirm: {
        title: "Block this account?",
        message: `${who} will not be able to sign in. Nothing is deleted, and unblocking lets them back in.`,
        confirmLabel: "Block",
      },
    });
  }

  // Available from active and from blocked: a hold can become a retirement without
  // being lifted first.
  actions.push({
    key: "deactivate", label: "Deactivate", to: "deleted", tone: "danger",
    confirm: {
      title: "Deactivate this account?",
      message: `${who} will be taken out of normal operations and cannot sign in. Their record and assignments are kept.`,
      confirmLabel: "Deactivate",
    },
  });

  return actions;
}

// How the account reads in a status column.
export function statusLabelFor(status: UserStatus | string): string {
  if (status === "active") return "Active";
  if (status === "blocked") return "Blocked";
  if (status === "deleted") return "Deactivated";
  if (status === "on_leave") return "On leave";
  return status;
}
