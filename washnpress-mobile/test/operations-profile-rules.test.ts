import { describe, it, expect } from "vitest";
import {
  OPERATOR_PROFILE_ENDPOINT, operatorProfileRequest, operatorProfileView,
} from "../src/portals/operations-profile-rules";

describe("operator profile matches Web ProfileTab", () => {
  it("shows email or an em dash when it is missing", () => {
    expect(operatorProfileView({ email: "op@washnpress.com" }).email).toBe("op@washnpress.com");
    expect(operatorProfileView({ email: null }).email).toBe("—");
    expect(operatorProfileView({ email: "" }).email).toBe("—");
    expect(operatorProfileView(null).email).toBe("—");
  });

  it("shows flatsCovered, and 0 when the field is missing", () => {
    expect(operatorProfileView({ flatsCovered: 48 }).flatsCovered).toBe(48);
    expect(operatorProfileView({ flatsCovered: 0 }).flatsCovered).toBe(0);
    expect(operatorProfileView({}).flatsCovered).toBe(0);
    expect(operatorProfileView(null).flatsCovered).toBe(0);
  });

  it("uses Web coverage fallbacks for empty society, supervisor and blocks", () => {
    const empty = operatorProfileView({});
    expect(empty.society).toBe("Unassigned");
    expect(empty.supervisor).toBe("None assigned");
    expect(empty.blocks).toBe("None assigned");
    expect(empty.fullName).toBe("—");
    expect(empty.phone).toBe("—");
    expect(empty.employeeId).toBe("—");

    expect(operatorProfileView({
      societyName: "Lakeside", supervisorName: "Meera", blockNames: ["A", "B"],
    })).toMatchObject({
      society: "Lakeside", supervisor: "Meera", blocks: "A, B",
    });
  });

  it("reads GET /v1/operations/profile, the same as Web operationsApi.profile", () => {
    expect(operatorProfileRequest()).toEqual({ method: "GET", path: OPERATOR_PROFILE_ENDPOINT });
    expect(OPERATOR_PROFILE_ENDPOINT).toBe("/v1/operations/profile");
  });
});
