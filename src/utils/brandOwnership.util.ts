// Brand ownership + non-destructive transfer helpers.
//
// When a brand is taken away from a vendor (reassigned to another vendor or
// released to the platform), that vendor's products under the brand must be
// deactivated and unassigned — but NEVER deleted, so order/cart/wishlist foreign
// keys stay intact. Superadmin can still see/edit them; the old vendor can't.

// Deactivate + unassign a vendor's products under a brand. Keeps brandId so the
// platform can still see/reactivate them under that brand.
export async function releaseVendorProductsForBrand(
  tx: any,
  brandId: number,
  vendorId: number,
): Promise<void> {
  await tx.product.updateMany({
    where: { brandId, ownerId: vendorId },
    data: { isActive: false, ownerId: null },
  });
}

// Reassign a brand to a new owner (a vendor id) or release it (null). If the
// brand currently belongs to a different vendor, that vendor's products under it
// are released first. No-op when the owner isn't actually changing.
export async function reassignBrandOwner(
  tx: any,
  brandId: number,
  newOwnerId: number | null,
): Promise<void> {
  const brand = await tx.brand.findUnique({
    where: { id: brandId },
    select: { ownerId: true },
  });
  if (!brand) return;

  const oldOwnerId = brand.ownerId as number | null;
  if (oldOwnerId === newOwnerId) return;

  if (oldOwnerId != null) {
    // Brand is moving away from its current vendor — release their products.
    await releaseVendorProductsForBrand(tx, brandId, oldOwnerId);
  }

  await tx.brand.update({
    where: { id: brandId },
    data: { ownerId: newOwnerId },
  });
}
