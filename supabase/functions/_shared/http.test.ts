import { HttpError, toJson } from "./http.ts";

Deno.test("toJson preserves nested JSON and omits undefined object fields", () => {
  const result = toJson({
    text: "ok",
    count: 3,
    enabled: true,
    nil: null,
    omitted: undefined,
    nested: [{ id: "a" }, 2]
  });

  assertEquals(result, {
    text: "ok",
    count: 3,
    enabled: true,
    nil: null,
    nested: [{ id: "a" }, 2]
  });
});

Deno.test("toJson rejects non-finite numbers", () => {
  assertThrowsHttpError(() => toJson({ score: Number.NaN }), "non-finite number");
  assertThrowsHttpError(() => toJson({ score: Number.POSITIVE_INFINITY }), "non-finite number");
});

Deno.test("toJson rejects circular structures", () => {
  const value: Record<string, unknown> = {};
  value.self = value;
  assertThrowsHttpError(() => toJson(value), "circular object");
});

Deno.test("toJson rejects unsupported runtime values", () => {
  assertThrowsHttpError(() => toJson({ value: 1n }), "non-JSON value");
  assertThrowsHttpError(() => toJson({ value: () => undefined }), "non-JSON value");
});

function assertThrowsHttpError(fn: () => unknown, expectedMessage: string): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof HttpError)) {
      throw new Error(`Expected HttpError, received ${String(error)}`);
    }
    if (!error.message.includes(expectedMessage)) {
      throw new Error(`Expected error message to include '${expectedMessage}', received '${error.message}'.`);
    }
    return;
  }
  throw new Error("Expected function to throw HttpError.");
}

function assertEquals(actual: unknown, expected: unknown): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}.`);
  }
}
