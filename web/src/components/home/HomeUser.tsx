import Link from "next/link";
import { ShieldAlert, Wrench, ArrowRight } from "lucide-react";
import { parsePermissions } from "@/lib/userContext";

interface HomeUserProps {
  /** Valeur brute de User.permissions (JSON array en base). */
  permissions: string;
}

/**
 * Page d'accueil pour les utilisateurs dont le rôle n'est pas configuré
 * pour la pipeline éditoriale (rôle USER ou rôle inconnu).
 *
 * - Si l'user a au moins une permission outil : accueil neutre + lien vers /tools.
 * - Sinon : message "Rôle non configuré" avec recommandation admin.
 */
export function HomeUser({ permissions }: HomeUserProps) {
  const userPerms = parsePermissions(permissions);
  const hasTools = userPerms.length > 0;

  if (hasTools) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 flex flex-col items-center text-center gap-6">
        <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center">
          <Wrench size={22} className="text-indigo-500" />
        </div>

        <div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Bienvenue</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            Vos outils sont disponibles. Retrouvez vos accès en cliquant
            ci-dessous.
          </p>
        </div>

        <Link
          href="/tools"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          Accéder à vos outils
          <ArrowRight size={14} />
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16 flex flex-col items-center text-center gap-6">
      <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
        <ShieldAlert size={22} className="text-amber-500" />
      </div>

      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          Rôle non configuré
        </h1>
        <p className="text-sm text-gray-500 leading-relaxed">
          Votre rôle n&apos;est pas configuré pour accéder à la pipeline
          éditoriale. Demandez à votre administrateur de vous assigner le rôle{" "}
          <span className="font-medium text-gray-700">Monteur</span> ou{" "}
          <span className="font-medium text-gray-700">CM</span> pour accéder
          aux publications qui vous sont assignées.
        </p>
      </div>

      <Link
        href="/tools"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
      >
        Accéder aux outils
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}
