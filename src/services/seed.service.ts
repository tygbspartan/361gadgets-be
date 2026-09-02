import prisma from "../config/database.config";
import { AuthService } from "./auth.service";
import { config } from "../config/env.config";
import { ROLES } from "../constants/roles.constants";

export class SeedService {
  // Ensure the seed account (ADMIN_EMAIL) exists as the platform SUPERADMIN.
  // In this codebase role "admin" = vendor and "superadmin" = platform operator,
  // so the seed must use superadmin — otherwise it creates a vendor.
  static async createAdminUser(): Promise<void> {
    try {
      const existing = await prisma.user.findUnique({
        where: { email: config.adminEmail },
      });

      if (existing) {
        // Self-heal an account created by the earlier (buggy) seed as a vendor.
        if (existing.role !== ROLES.SUPERADMIN) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { role: ROLES.SUPERADMIN, isActive: true },
          });
          console.log("✅ Seed account promoted to superadmin");
        }
        return;
      }

      const passwordHash = await AuthService.hashPassword(config.adminPassword);

      await prisma.user.create({
        data: {
          email: config.adminEmail,
          passwordHash,
          firstName: config.adminFirstName,
          lastName: config.adminLastName,
          role: ROLES.SUPERADMIN,
          isActive: true,
          isEmailVerified: true, // Superadmin doesn't need email verification
        },
      });

      console.log("✅ Superadmin user created");
    } catch (error) {
      console.error("❌ Failed to create superadmin user:", error);
      throw error;
    }
  }

  // Run all seed functions
  static async runSeed(): Promise<void> {
    try {
      await this.createAdminUser();
      // Add more seed functions here in the future
      // await this.createCategories();
      // await this.createBrands();
    } catch (error) {
      console.error("❌ Seed process failed:", error);
      throw error;
    }
  }
}
