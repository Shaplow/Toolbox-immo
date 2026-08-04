/**
 * Déclenchement de téléchargements navigateur depuis des URLs pré-signées R2.
 *
 * Extrait de `components/publications/sections/RushesSection.tsx`, où le
 * mécanisme a été mis au point, pour être partagé avec la médiathèque.
 *
 * Pourquoi des iframes et pas des `<a download>` :
 * un `<a>` vers une URL cross-origin (R2) déclenche une navigation top-level —
 * Chrome ignore l'attribut `download` en cross-origin — et le navigateur
 * n'autorise QU'UNE navigation top-level à la fois. Sur N clics successifs, les
 * déclenchements se court-circuitent et un seul fichier survit. Un iframe caché
 * par fichier donne à chacun son propre contexte de navigation : ils
 * téléchargent indépendamment, pilotés par le `Content-Disposition: attachment`
 * porté par l'URL pré-signée.
 *
 * Le décalage entre deux déclenchements évite en prime le blocage en rafale :
 * le navigateur demande l'autorisation « téléchargements multiples » une seule
 * fois au lieu de refuser les suivants.
 */

/** Décalage entre deux déclenchements (ms). */
const STAGGER_MS = 400;

/**
 * Délai avant retrait de l'iframe (ms). Large et volontairement découplé de la
 * durée du téléchargement : une fois le transfert pris en main par le
 * gestionnaire du navigateur, l'iframe n'a plus de rôle.
 */
const CLEANUP_MS = 60_000;

/**
 * Déclenche le téléchargement de chaque URL, échelonné dans le temps.
 *
 * Ne renvoie rien et n'attend pas la fin des transferts : le navigateur en
 * prend le relais. L'appelant garde la main sur le feedback utilisateur (toast).
 */
export function triggerDownloads(urls: string[]): void {
  urls
    .filter((url) => !!url)
    .forEach((url, i) => {
      setTimeout(() => {
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = url;
        document.body.appendChild(iframe);
        setTimeout(() => iframe.remove(), CLEANUP_MS);
      }, i * STAGGER_MS);
    });
}

/**
 * Téléchargement d'un fichier unique.
 *
 * Un seul transfert = une seule navigation, donc le `<a>` passe et conserve
 * l'avantage de proposer un nom de fichier côté client même si le
 * `Content-Disposition` venait à manquer.
 */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
