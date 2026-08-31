import prisma from "../config/database.config";
import { AuthService } from "./auth.service";
import { config } from "../config/env.config";

export class SeedService {
  // Create admin user if it doesn't exist
  static async createAdminUser(): Promise<void> {
    try {
      // Check if admin already exists
      const existingAdmin = await prisma.user.findUnique({
        where: { email: config.adminEmail },
      });

      if (existingAdmin) return;

      // Create admin user
      const passwordHash = await AuthService.hashPassword(config.adminPassword);

      await prisma.user.create({
        data: {
          email: config.adminEmail,
          passwordHash,
          firstName: config.adminFirstName,
          lastName: config.adminLastName,
          role: "admin",
          isEmailVerified: true, // Admin doesn't need email verification
        },
      });

      console.log("✅ Admin user created");
    } catch (error) {
      console.error("❌ Failed to create admin user:", error);
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
