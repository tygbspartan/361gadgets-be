import { withTxRetry } from "../../utils/retryTransaction.util";
import { ConflictError } from "../../utils/customError.util";

// A Prisma-shaped error carrying a `code` (that's what withTxRetry inspects).
function prismaError(code: string) {
  const e: any = new Error(`prisma ${code}`);
  e.code = code;
  return e;
}

describe("withTxRetry", () => {
  it("returns the result on first success (no retries)", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    await expect(withTxRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient P2028 (pool exhausted) then succeeds", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(prismaError("P2028"))
      .mockResolvedValue("recovered");
    await expect(withTxRetry(fn, 3, 1)).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries transient P2034 (deadlock) too", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(prismaError("P2034"))
      .mockResolvedValue("ok");
    await expect(withTxRetry(fn, 3, 1)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries and rethrows the transient error", async () => {
    const fn = jest.fn().mockRejectedValue(prismaError("P2028"));
    await expect(withTxRetry(fn, 2, 1)).rejects.toMatchObject({ code: "P2028" });
    // initial attempt + 2 retries
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry business errors (out-of-stock ConflictError)", async () => {
    const fn = jest.fn().mockRejectedValue(new ConflictError("out of stock"));
    await expect(withTxRetry(fn, 3, 1)).rejects.toBeInstanceOf(ConflictError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry the idempotency unique-violation P2002", async () => {
    const fn = jest.fn().mockRejectedValue(prismaError("P2002"));
    await expect(withTxRetry(fn, 3, 1)).rejects.toMatchObject({ code: "P2002" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
