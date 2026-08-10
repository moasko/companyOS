import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/// Les BigInt (quota, taille) ne passent pas JSON.stringify tels quels.
/// On les sérialise en Number : au-delà de 9 Po on aura d'autres soucis.
export const serialize = (value) =>
  JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? Number(v) : v)),
  );
