import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { OnboardingStatus } from "../api/types";
import { Screen, PageTitle, SectionTitle, Field, Button, ErrorText, Notice, ChoiceChips, Loading } from "../components/ui";

// A newly registered resident completes their profile before the rest of the app
// becomes usable. Once complete they are never asked again: the backend records
// the onboarding flag and the session is reissued with the resident scope.
export function OnboardingScreen({ token, onComplete }: { token: string; onComplete: (nextToken: string | null) => void }) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [societyId, setSocietyId] = useState<string | null>(null);
  const [unitNumber, setUnitNumber] = useState("");
  const [towerBlock, setTowerBlock] = useState("");
  const [address, setAddress] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.onboardingStatus(token);
      setStatus(r);
      if (r.completed) onComplete(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, onComplete]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!societyId) { setError("Choose your society."); return; }
    setBusy(true); setError(null);
    try {
      const r = await api.completeOnboarding({
        fullName, societyId, unitNumber,
        email: email || undefined, towerBlock: towerBlock || undefined,
        address: address || undefined, pickupAddress: pickupAddress || address || undefined,
      }, token);
      onComplete(r.token);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (busy && !status) return <Loading />;

  const canSubmit = fullName.trim().length >= 2 && Boolean(societyId) && unitNumber.trim().length > 0 && (pickupAddress.trim() || address.trim()).length > 0;

  return (
    <Screen>
      <PageTitle title="Complete your profile" subtitle="A few details before your first pickup" />
      <Notice text="We need these details so the operations team can collect and return your garments." />
      <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Anusha" />
      <Field label="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" />

      <SectionTitle>Society</SectionTitle>
      <ChoiceChips
        options={(status?.societies ?? []).map((s) => s.id)}
        value={societyId}
        onChange={setSocietyId}
        labelOf={(id) => status?.societies.find((s) => s.id === id)?.name ?? id}
      />

      <Field label="Flat / unit number" value={unitNumber} onChangeText={setUnitNumber} placeholder="A-402" />
      <Field label="Tower / block (optional)" value={towerBlock} onChangeText={setTowerBlock} placeholder="A" />
      <Field label="Address" value={address} onChangeText={setAddress} placeholder="A-402, My Home Bhooja, Kavuri Hills" />
      <Field label="Pickup address" value={pickupAddress} onChangeText={setPickupAddress} placeholder="Same as address if left blank" />

      <Button label="Complete onboarding" onPress={submit} disabled={!canSubmit || busy} />
      <ErrorText error={error} />
    </Screen>
  );
}
