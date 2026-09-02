import { describe, it, expect } from "vitest";
import {
  ALLOWED_TYPES, MAX_BYTES, MAX_PER_TICKET,
  checkAttachment, decodedSize, isBase64, stripDataUrl,
} from "../../src/domain/attachments";

// "The shirt came back with a tear in the sleeve" is a sentence somebody has to take
// on trust. A photograph of the tear is the same complaint with the argument already
// settled — which is the whole point of letting one be attached, and the reason the
// rules around it are about keeping it a photograph rather than a file share.

const ok = { contentType: "image/jpeg", sizeBytes: 1024, existingCount: 0 };

describe("what may be attached to a ticket", () => {
  it("accepts a photograph", () => {
    expect(checkAttachment(ok).ok).toBe(true);
  });

  it("accepts every format a phone camera produces", () => {
    for (const contentType of ALLOWED_TYPES) {
      expect(checkAttachment({ ...ok, contentType }).ok, contentType).toBe(true);
    }
  });

  it("refuses anything that is not a photograph", () => {
    // Accepting arbitrary files would make this a file share with an access control
    // problem, which is not what a support ticket is for.
    for (const contentType of ["application/pdf", "text/html", "application/zip", "image/svg+xml"]) {
      const result = checkAttachment({ ...ok, contentType });
      expect(result.ok, contentType).toBe(false);
    }
  });

  it("refuses an empty file", () => {
    expect(checkAttachment({ ...ok, sizeBytes: 0 }).ok).toBe(false);
  });

  it("refuses one over the cap", () => {
    expect(checkAttachment({ ...ok, sizeBytes: MAX_BYTES + 1 }).ok).toBe(false);
    expect(checkAttachment({ ...ok, sizeBytes: MAX_BYTES }).ok).toBe(true);
  });

  it("says how big is too big, rather than just refusing", () => {
    const refusal = checkAttachment({ ...ok, sizeBytes: MAX_BYTES + 1 });
    expect(refusal.ok).toBe(false);
    expect(refusal.ok === false && refusal.reason).toMatch(/2 MB/);
  });

  it("stops at five to a ticket", () => {
    // Enough to photograph a garment from several angles, few enough that a
    // conversation does not turn into an album.
    expect(checkAttachment({ ...ok, existingCount: MAX_PER_TICKET - 1 }).ok).toBe(true);
    expect(checkAttachment({ ...ok, existingCount: MAX_PER_TICKET }).ok).toBe(false);
  });
});

describe("reading what the client actually sent", () => {
  it("takes the type out of a data URL, because the browser puts it there", () => {
    const { contentType, data } = stripDataUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(contentType).toBe("image/png");
    expect(data).toBe("iVBORw0KGgo=");
  });

  it("leaves a bare base64 string alone", () => {
    const { contentType, data } = stripDataUrl("iVBORw0KGgo=");
    expect(contentType).toBeNull();
    expect(data).toBe("iVBORw0KGgo=");
  });

  it("does not keep the prefix, which would corrupt the file by its own length", () => {
    const { data } = stripDataUrl("data:image/jpeg;base64,/9j/4AAQSkZJRg==");
    expect(data.startsWith("data:")).toBe(false);
    expect(data).toBe("/9j/4AAQSkZJRg==");
  });

  it("works out the real size rather than trusting the caller", () => {
    // The cap is enforced on this number, so taking the client's word for it would
    // make the cap advisory.
    expect(decodedSize("")).toBe(0);
    // "hello world" is eleven bytes.
    expect(decodedSize(Buffer.from("hello world").toString("base64"))).toBe(11);
    // A megabyte of zeroes stays a megabyte.
    expect(decodedSize(Buffer.alloc(1024 * 1024).toString("base64"))).toBe(1024 * 1024);
  });

  it("recognises base64 and rejects what is not", () => {
    expect(isBase64(Buffer.from("a photo").toString("base64"))).toBe(true);
    expect(isBase64("not base64!!")).toBe(false);
    expect(isBase64("")).toBe(false);
    // Length has to be a multiple of four or it is truncated rather than encoded.
    expect(isBase64("abcde")).toBe(false);
  });
});
