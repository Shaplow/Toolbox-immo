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
        token.role = (user as { role?: string }).role ?? "USER";
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
