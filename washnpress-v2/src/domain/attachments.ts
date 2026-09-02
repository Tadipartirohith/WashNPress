// A photograph attached to a support ticket.
//
// "The shirt came back with a tear in the sleeve" is a sentence somebody has to take
// on trust. A photograph of the tear is the same complaint with the argument already
// settled, and it is the difference between a dispute that takes four messages and
// one that takes none.
//
// The bytes are held in the document store rather than on a disk or in a bucket. That
// is a deliberate trade for this size of platform: it needs no new dependency, it
// works identically in the memory adapter the tests run on and in Postgres, and it
// survives a container being replaced. It is the wrong answer at a scale where photos
// are measured in gigabytes, and the shape here — an id, a content type, and a route
// that serves it — is the shape a bucket would use too, so the swap is one adapter
// rather than one feature.
//
// What follows is the part that has to be true wherever the bytes end up.

export interface Attachment {
  id: string;
  // What it is attached to. A ticket for now; the field is named for the thing
  // rather than for support, because an order dispute wants the same mechanism.
  ticketId: string;
  uploadedByUserId: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  // Base64, without the `data:` prefix a browser puts in front of it.
  data: string;
  createdAt: string;
}

// What a screen is told about an attachment: everything except the bytes.
export type AttachmentSummary = Omit<Attachment, "data">;

// Photographs only.
//
// A support attachment is evidence about a garment, and the honest way to keep it
// that way is to accept the formats a camera produces and nothing else. Accepting
// arbitrary files would make this an file-sharing feature with an access-control
// problem, which is not what anybody asked for.
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;

// Two megabytes, which is a photograph from a phone once it has been scaled for
// upload and comfortably more than a picture of a sleeve needs. The cap exists
// because the bytes travel through JSON and sit in a row: without one, a single
// twelve megapixel original would be a forty megabyte request.
export const MAX_BYTES = 2 * 1024 * 1024;

// Five to a ticket. Enough to photograph a garment from several angles, few enough
// that a conversation does not turn into an album.
export const MAX_PER_TICKET = 5;

export type AttachmentRefusal =
  | { ok: false; reason: string }
  | { ok: true; reason: null };

export function checkAttachment(input: {
  contentType: string;
  sizeBytes: number;
  existingCount: number;
}): AttachmentRefusal {
  if (!(ALLOWED_TYPES as readonly string[]).includes(input.contentType)) {
    return { ok: false, reason: "Attach a photograph — JPEG, PNG, WebP or HEIC." };
  }
  if (input.sizeBytes <= 0) return { ok: false, reason: "That file is empty." };
  if (input.sizeBytes > MAX_BYTES) {
    return { ok: false, reason: `A photograph has to be under ${Math.round(MAX_BYTES / (1024 * 1024))} MB.` };
  }
  if (input.existingCount >= MAX_PER_TICKET) {
    return { ok: false, reason: `A ticket holds ${MAX_PER_TICKET} photographs. Remove one to add another.` };
  }
  return { ok: true, reason: null };
}

// How many bytes a base64 string actually decodes to.
//
// Worked out rather than trusted from the client: the size is the thing the cap is
// enforced on, so taking the caller's word for it would make the cap advisory.
export function decodedSize(base64: string): number {
  const clean = base64.replace(/\s/g, "");
  if (clean.length === 0) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, (clean.length * 3) / 4 - padding);
}

// A browser hands over `data:image/jpeg;base64,/9j/4AAQ...`. The prefix is not part
// of the data and storing it would corrupt every file by exactly its own length.
export function stripDataUrl(value: string): { contentType: string | null; data: string } {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value.trim());
  if (!match) return { contentType: null, data: value.trim() };
  return { contentType: match[1], data: match[2] };
}

export function isBase64(value: string): boolean {
  const clean = value.replace(/\s/g, "");
  return clean.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(clean) && clean.length % 4 === 0;
}
