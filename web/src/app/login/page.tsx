"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      identifier,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Identifiant ou mot de passe incorrect.");
    } else {
      router.push("/home");
      router.refresh();
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-muted overflow-hidden">
      {/* Halo décoratif discret */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 -right-32 w-96 h-96 bg-info-200/40 rounded-full blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-32 w-96 h-96 bg-danger-200/40 rounded-full blur-3xl"
      />

      <div className="relative bg-card rounded-lg shadow-lg border border-border p-10 w-full max-w-sm">
        {/* Logo / Titre */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary rounded-md mb-4">
            <span className="text-primary-foreground text-2xl font-bold tracking-tight">T</span>
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Toolbox Immo</h1>
          <p className="text-sm text-muted-foreground mt-1">Espace de création</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Identifiant ou email
            </label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              placeholder="Identifiant ou email"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-info-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-info-200"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg text-sm transition-colors disabled:opacity-60 shadow-sm"
          >
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Pipeline éditorial pour agents immobiliers
        </p>
      </div>
    </div>
  );
}
