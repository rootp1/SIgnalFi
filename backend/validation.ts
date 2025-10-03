import { z } from 'zod';

export const followRequestSchema = z.object({
  userId: z.number().int().positive(),
  traderToFollow: z.number().int().positive()
});

export const settingsUpdateSchema = z.object({
  userId: z.number().int().positive(),
  tradeAmount: z.string().regex(/^[0-9]*\.?[0-9]+$/).optional(),
  riskMultiplier: z.string().regex(/^[0-9]*\.?[0-9]+$/).optional(),
  notifySignals: z.boolean().optional()
});

export const unfollowSchema = z.object({
  userId: z.number().int().positive(),
  traderId: z.number().int().positive()
});

// Signal payload validation
export const signalPayloadSchema = z.object({
  symbol: z.string().min(1).max(20).regex(/^[A-Z0-9:_\-]+$/i),
  side: z.enum(['BUY','SELL','LONG','SHORT']),
  marketType: z.enum(['spot','perp']).optional(),
  entry: z.number().positive().optional(),
  targets: z.array(z.number().positive()).max(10).optional(),
  stop: z.number().positive().optional(),
  size: z.number().positive().optional(),
  confidence: z.number().min(0).max(100).optional(),
  note: z.string().max(300).optional(),
  metadata: z.record(z.any()).optional()
});

export const signalRequestSchema = z.object({
  traderId: z.number().int().positive(),
  payload: signalPayloadSchema
});

export type SignalPayload = z.infer<typeof signalPayloadSchema>;
export type SignalRequest = z.infer<typeof signalRequestSchema>;

export type FollowRequest = z.infer<typeof followRequestSchema>;
export type SettingsUpdateRequest = z.infer<typeof settingsUpdateSchema>;
export type UnfollowRequest = z.infer<typeof unfollowSchema>;

export function parse<T>(schema: z.ZodSchema<T>, data: unknown): { data?: T; error?: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    return { error: result.error.issues.map((i: any) => i.message).join(', ') };
  }
  return { data: result.data };
}
