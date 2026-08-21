import type { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      /** JSON string — ex: '["captions","templates:generate"]' */
      permissions: string;
      /** Agence (Client) rattachée — comptes externes bons de commande. */
      clientId: string | null;
    } & DefaultSession["user"];
  }
  interface User {
    role?: string;
    permissions?: string;
    clientId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id?: string;
    role?: string;
    permissions?: string;
    clientId?: string | null;
  }
}
