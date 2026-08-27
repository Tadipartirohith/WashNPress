import { describe, it, expect } from "vitest";
import {
  fullNameOf, isEmail, nameOf, nextEmployeeId, splitFullName, staffDetailProblems,
} from "../../src/domain/staff-identity";

describe("a name in the two parts it is made of", () => {
  it("joins them back for everything written against one name", () => {
    expect(fullNameOf({ firstName: "Suresh", lastName: "Kumar" })).toBe("Suresh Kumar");
  });

  it("reads a name recorded before the split", () => {
    // Everything up to the last space is the first name: the only split a machine
    // can make, and the one most often right.
    expect(splitFullName("Suresh Kumar")).toEqual({ firstName: "Suresh", lastName: "Kumar" });
    expect(splitFullName("Rama Krishna Rao")).toEqual({ firstName: "Rama Krishna", lastName: "Rao" });
    expect(splitFullName("Anusha")).toEqual({ firstName: "Anusha", lastName: "" });
    expect(splitFullName(null)).toEqual({ firstName: "", lastName: "" });
  });

  it("prefers the two parts when an account has them", () => {
    expect(nameOf({ fullName: "Wrong Name", firstName: "Right", lastName: "Name" }))
      .toEqual({ firstName: "Right", lastName: "Name" });
    // And falls back to splitting the joined one when it does not.
    expect(nameOf({ fullName: "Old Record", firstName: null, lastName: null }))
      .toEqual({ firstName: "Old", lastName: "Record" });
  });
});

describe("employee ids are generated, not typed", () => {
  it("carries a prefix that says what the id belongs to", () => {
    expect(nextEmployeeId("supervisor", [])).toBe("SUP-001");
    expect(nextEmployeeId("operator", [])).toBe("WNP-OPS-001");
  });

  it("takes the next one after the highest already in use", () => {
    expect(nextEmployeeId("operator", ["WNP-OPS-001", "WNP-OPS-007"])).toBe("WNP-OPS-008");
  });

  it("counts past the hundredth without sorting it between the ninth and the tenth", () => {
    expect(nextEmployeeId("supervisor", ["SUP-099"])).toBe("SUP-100");
  });

  it("never hands out one that is already taken", () => {
    // A number typed by hand is a number eventually typed twice, and the collision
    // shows up as two people sharing an id rather than as an error.
    const used = ["WNP-OPS-001", "WNP-OPS-002", "WNP-OPS-003"];
    expect(used).not.toContain(nextEmployeeId("operator", used));
  });

  it("ignores ids that do not follow the pattern rather than choking on them", () => {
    expect(nextEmployeeId("supervisor", ["legacy-42", null, undefined])).toBe("SUP-001");
  });
});

describe("what has to be right before an account is made", () => {
  it("wants both parts of the name, a mobile number and an address", () => {
    expect(staffDetailProblems({
      firstName: "Suresh", lastName: "Kumar", phone: "9876500011", email: "s@example.com",
    })).toEqual([]);
  });

  it("says everything that is wrong at once, not one field at a time", () => {
    const problems = staffDetailProblems(
      { firstName: "", lastName: "", phone: "123", email: "nope" }, { emailRequired: true });
    expect(problems).toHaveLength(4);
  });

  it("only insists on an address where the role needs one", () => {
    // A supervisor is reached on their phone and signs in with it, so an email is
    // somewhere to send them things rather than something the account cannot exist
    // without. An operator's is asked for.
    const without = { firstName: "Suresh", lastName: "Kumar", phone: "9876500011" };
    expect(staffDetailProblems(without)).toEqual([]);
    expect(staffDetailProblems(without, { emailRequired: true })).toEqual(["An email address is needed"]);
  });

  it("still checks an address that was given, required or not", () => {
    // An optional field is not a field where anything goes.
    expect(staffDetailProblems({
      firstName: "Suresh", lastName: "Kumar", phone: "9876500011", email: "nope",
    })).toEqual(["A valid email address is needed"]);
  });

  it("knows an address from something with an at sign in it", () => {
    expect(isEmail("ravi@washnpress.example")).toBe(true);
    expect(isEmail("ravi@washnpress")).toBe(false);
    expect(isEmail("ravi.washnpress.example")).toBe(false);
    expect(isEmail("")).toBe(false);
  });
});
