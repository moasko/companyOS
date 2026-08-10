// Signature d'une fiche : qui l'a saisie, qui l'a touchée en dernier.
//
// Dans un espace à plusieurs, « qui a mis ce prix » est la première question
// posée devant un chiffre surprenant. Chaque module la répond de la même
// façon, avec les mêmes mots.
//
//   <Auteur record={client} />
//
// `record` est ce que renvoie `api.records` : le serveur y joint `auteur` et
// `modifiePar` (voir server/src/routes/records.js).

import { Avatar } from "./Avatar";
import "./auteur.scss";

/// Date lisible, sans heure : sur une fiche, le jour suffit.
const jour = (iso) =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export const Auteur = ({ record, className = "" }) => {
  if (!record?.createdAt) return null;

  const { auteur, modifiePar, createdAt, updatedAt } = record;
  // Une fiche enregistrée puis rouverte porte deux dates à quelques
  // secondes d'écart : ce n'est pas une modification digne d'être signalée.
  const modifiee =
    modifiePar && new Date(updatedAt) - new Date(createdAt) > 60000;

  return (
    <div className={`cosAuteur ${className}`}>
      <Avatar user={auteur} nom={auteur?.name || "?"} taille={20} />
      <span>
        Saisi par <strong>{auteur?.name || "un compte supprimé"}</strong> le{" "}
        {jour(createdAt)}
        {modifiee ? (
          <>
            {" · modifié par "}
            <strong>{modifiePar.name}</strong> le {jour(updatedAt)}
          </>
        ) : null}
      </span>
    </div>
  );
};

export default Auteur;
