import { z } from 'zod';

export const loginRequestSchema = z.object({ username: z.string(), password: z.string() });
export type LoginRequest = z.infer<typeof loginRequestSchema>;
