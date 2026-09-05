"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { Button } from "@/components/ui/button";
import { useAsync } from "@/lib/use-async";
import { operationsApi, type QcFailureReason } from "@/lib/api/operations";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// A QC failure has to say why. The reason decides where the work goes back to and
// whether a supervisor or the resident hears about it, so it is required up front
// rather than accepted as a bare "failed" — the backend enforces the same rule.
export function QcFailModal({
  title, onClose, onSubmit, busy, error,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (input: { reason: QcFailureReason; remarks: string; evidenceUrl?: string; evidencePhoto?: { filename?: string; contentType: string; data: string } }) => void;
  busy: boolean;
  error: string | null;
}) {
  const reasons = useAsync(() => operationsApi.qcReasons(), []);
  const [reason, setReason] = useState<QcFailureReason | "">("");
  const [remarks, setRemarks] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [photo, setPhoto] = useState<{ filename?: string; contentType: string; data: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const selected = reasons.data?.reasons.find((r) => r.key === reason) ?? null;
  const needsEvidence = selected?.evidenceRequired ?? false;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = await readAsDataUrl(file);
      setPhoto({ filename: file.name, contentType: file.type, data });
      setPhotoError(null);
    } catch {
      setPhotoError("Could not read that photo — try another one.");
    }
  };

  const submit = () => {
    if (!reason || !remarks.trim()) return;
    if (needsEvidence && !photo && !evidenceUrl.trim()) return;
    onSubmit({
      reason,
      remarks: remarks.trim(),
      evidenceUrl: evidenceUrl.trim() || undefined,
      evidencePhoto: photo ?? undefined,
    });
  };

  return (
    <Modal open onClose={onClose} title={title} description="Say why this failed — the reason decides where it goes next.">
      <div className="space-y-4">
        <FormField as="select" label="Reason" required value={reason} onChange={(e) => setReason(e.target.value as QcFailureReason)}>
          <option value="">Choose a reason</option>
          {reasons.data?.reasons.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </FormField>
        <FormField as="textarea" label="What went wrong" required value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        {needsEvidence && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {selected?.label} needs a photograph <span className="text-danger">*</span>
            </p>
            <input
              type="file" accept="image/*" capture="environment"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary/15 file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary"
            />
            {photo && <p className="text-xs text-success">Photo attached: {photo.filename}</p>}
            {photoError && <p className="text-xs text-danger">{photoError}</p>}
            <input
              value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)}
              placeholder="or paste a link to a photo"
              className="w-full rounded-lg border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1 bg-danger text-white shadow-none hover:brightness-110"
            onClick={submit}
            disabled={busy || !reason || !remarks.trim() || (needsEvidence && !photo && !evidenceUrl.trim())}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Fail this batch"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
