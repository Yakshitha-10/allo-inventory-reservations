import { z } from "zod";

export const reserveSchema = z.object({
  productId: z.string().min(1),
  warehouseId: z.string().min(1),
  quantity: z.coerce.number().int().positive().max(100),
});

export type ReserveInput = z.infer<typeof reserveSchema>;
