import React from "react";
import { useSelector } from "react-redux";
import { api } from "../../api/client";
import { ConfigurationMfa } from "./ConfigurationMfa";

/// Recouvre le bureau tant que la double authentification exigée (par
/// l'espace, ou pour un exploitant) n'est pas configurée. Le serveur refuse
/// de toute façon chaque requête d'ici là : cet écran dit pourquoi, et
/// permet d'y remédier sans quitter la page.
export const MfaObligatoire = () => {
  const session = useSelector((state) => state.session);
  if (session.status !== "authenticated" || !session.mfaAConfigurer) return null;

  return (
    <div className="mfaObligatoire" role="dialog" aria-modal="true" aria-labelledby="mfaObligatoireTitre">
      <div className="mfaCarte">
        <h2 id="mfaObligatoireTitre">Activez la double authentification</h2>
        <p className="mfaAide">
          {session.tenant?.name ? `L'espace « ${session.tenant.name} »` : "Votre compte"} exige
          un second facteur à la connexion : un code à usage unique, généré par une
          application sur votre téléphone. Cela prend une minute.
        </p>
        <ConfigurationMfa
          email={session.user?.email}
          // La session a maintenant son second facteur : on recharge pour
          // démarrer l'espace normalement.
          onTermine={() => window.location.reload()}
        />
        <button
          type="button"
          className="mfaLien"
          onClick={async () => {
            await api.logout().catch(() => {});
            window.location.reload();
          }}
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
};
