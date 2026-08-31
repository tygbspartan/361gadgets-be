import {
  CustomError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  TooManyRequestsError,
  InternalServerError,
} from "../../utils/customError.util";

describe("custom error classes", () => {
  it("maps each error type to the right HTTP status", () => {
    expect(new BadRequestError().statusCode).toBe(400);
    expect(new UnauthorizedError().statusCode).toBe(401);
    expect(new ForbiddenError().statusCode).toBe(403);
    expect(new NotFoundError().statusCode).toBe(404);
    expect(new ConflictError().statusCode).toBe(409);
    expect(new ValidationError().statusCode).toBe(422);
    expect(new TooManyRequestsError().statusCode).toBe(429);
    expect(new InternalServerError().statusCode).toBe(500);
  });

  it("is an instance of Error and CustomError (so errorHandler catches it)", () => {
    const err = new NotFoundError("nope");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CustomError);
    expect(err.message).toBe("nope");
  });

  it("carries a field-errors payload when provided", () => {
    const err = new BadRequestError("Validation failed", {
      email: ["Invalid email address"],
    });
    expect(err.errors).toEqual({ email: ["Invalid email address"] });
  });

  it("uses sensible default messages", () => {
    expect(new UnauthorizedError().message).toBe("Unauthorized");
    expect(new ConflictError().message).toBe("Conflict");
  });
});
