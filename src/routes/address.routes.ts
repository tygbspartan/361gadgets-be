import { Router } from "express";
import { AddressController } from "../controllers/address.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validateBody } from "../middleware/validate";
import { addressSchema } from "../validators/schemas";

const router = Router();

// All address routes are for the logged-in user's own address book.
router.get("/", authenticate, AddressController.list);
router.post("/", authenticate, validateBody(addressSchema), AddressController.create);
router.put("/:id", authenticate, validateBody(addressSchema), AddressController.update);
router.delete("/:id", authenticate, AddressController.remove);

export default router;
