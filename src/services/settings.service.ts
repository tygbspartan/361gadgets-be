import prisma from "../config/database.config";

// Singleton platform settings (row id = 1). Auto-creates defaults on first read.
export const SettingsService = {
  async get() {
    const existing = await prisma.platformSettings.findUnique({
      where: { id: 1 },
    });
    if (existing) return existing;
    return prisma.platformSettings.create({ data: { id: 1 } });
  },
};
