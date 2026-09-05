"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { Button } from "@/components/ui/button";
import { useAction } from "@/lib/use-async";
import { operationsApi, type PickupQueueItem } from "@/lib/api/operations";

// A failed pickup is preserved with a reason, never silently dropped — the order
// moves to `pickup_failed` and can be rescheduled later, but the reason stays on
// the record.
export function PickupFailedModal({
  pickup, onClose, onDone,
}: {
  pickup: PickupQueueItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const action = useAction(operationsApi.pickupFailed);

  const submit = async () => {
    if (!reason.trim() || !pickup.orderId) return;
    await action.run(pickup.orderId, reason.trim());
    onDone();
  };

  return (
    <Modal open onClose={onClose} title="Record a failed pickup" description={`${pickup.residentName ?? "Resident"} · ${pickup.unitNumber ?? ""}`}>
      <div className="space-y-4">
        <FormField
          as="textarea" label="Why couldn't this be collected" required
          value={reason} onChange={(e) => setReason(e.target.value)}
          hint="Kept on the order's record — nothing here is silently dropped."
        />
        {action.error && <p className="text-sm text-danger">{action.error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="flex-1 bg-danger text-white shadow-none hover:brightness-110" onClick={submit} disabled={action.busy || !reason.trim()}>
            {action.busy ? <Loader2 className="size-4 animate-spin" /> : "Record failure"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
