import * as z from 'zod';

export const BaseJwtClaimsSchema = z.object({
  iss: z.string(),
  sub: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  iat: z.number(),
  nbf: z.number().optional(),
  nonce: z.string(),
});
