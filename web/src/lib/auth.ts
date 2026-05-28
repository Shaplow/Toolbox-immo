import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        identifier: { label: "Identifiant ou email", type: "text" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials?.password) return null;
        const id = credentials.identifier as string;
        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { username: { equals: id, mode: "insensitive" } },
              { email: { equals: id, mode: "insensitive" } },
            ],
          },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          permissions: user.permissions, // JSON string "[\"captions\",\"templates:generate\"]"
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "EXTERNAL_GENERATOR";
        // Parse, validate and re-serialize permissions so the JWT always
        // carries a well-formed JSON array string, never a corrupt value.
        const rawPermissions = (user as { permissions?: string }).permissions ?? "[]";
        let parsedPermissions: string[] = [];
        try {
          const parsed = JSON.parse(rawPermissions);
          if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
            parsedPermissions = parsed;
          } else {
            console.warn(`[auth] Invalid permissions format for user ${user.id} — defaulting to []`);
          }
        } catch {
          console.warn(`[auth] Failed to parse permissions for user ${user.id} — defaulting to []`);
        }
        token.permissions = JSON.stringify(parsedPermissions);
        token.refreshedAt = Math.floor(Date.now() / 1000);
        return token;
      }

      // ─── Refresh role + permissions périodiquement depuis la DB ──────────────
      // Sans ce check, un user dégradé d'ADMIN à MONTEUR garde session.user.role
      // = "ADMIN" jusqu'à expiration du JWT (30j default). On re-lit toutes
      // les 5 min : cadence assez longue pour ne pas plomber la perf serverless,
      // assez courte pour qu'un revoke admin se propage en <5 min.
      const REFRESH_INTERVAL_S = 5 * 60;
      const lastRefresh = (token.refreshedAt as number | undefined) ?? 0;
      const now = Math.floor(Date.now() / 1000);
      if (token.id && now - lastRefresh > REFRESH_INTERVAL_S) {
        try {
          const fresh = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { role: true, permissions: true },
          });
          if (!fresh) {
            // Compte supprimé — invalider le token pour forcer un re-login.
            // NextAuth ne supporte pas le throw clean ici ; on neutralise les
            // claims pour que getUserContext renvoie 401 partout en amont.
            token.id = undefined;
            token.role = undefined;
            token.permissions = undefined;
          } else {
            token.role = fresh.role;
            try {
              const parsed = JSON.parse(fresh.permissions);
              if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
                token.permissions = JSON.stringify(parsed);
              }
            } catch {
              token.permissions = "[]";
            }
            token.refreshedAt = now;
          }
        } catch (err) {
          // En cas d'erreur DB transitoire, on garde le token actuel (best-effort).
          // L'erreur sera retentée au prochain hit après la fenêtre de refresh.
          console.warn("[auth/jwt] DB refresh failed, keeping cached token", err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id) session.user.id = token.id as string;
      if (token?.role) session.user.role = token.role as string;
      if (token?.permissions) session.user.permissions = token.permissions as string;
      return session;
    },
  },
});
