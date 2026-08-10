// Avatar d'une personne — un seul composant pour tout l'OS.
//
// Sans photo, on affiche les initiales sur une couleur tirée du nom. C'est
// mieux qu'une silhouette grise ou qu'une photo d'inconnu : dans une liste
// de membres, la couleur seule permet déjà de retrouver quelqu'un.
//
//   <Avatar user={session.user} taille={38} />
//   <Avatar nom="Awa Koné" taille={26} />

import "./avatar.scss";

/// Palette lisible en clair comme en sombre, texte blanc dessus.
const COULEURS = [
  "#1a73e8",
  "#188038",
  "#b06000",
  "#a142f4",
  "#c5221f",
  "#0b8043",
  "#3367d6",
  "#c2185b",
];

/// Même nom, toujours la même couleur — y compris d'une session à l'autre et
/// d'un poste à l'autre. Une somme de codes de caractères suffit : on cherche
/// de la constance, pas de la cryptographie.
const couleurDe = (nom = "") => {
  let somme = 0;
  for (let i = 0; i < nom.length; i += 1) somme += nom.charCodeAt(i);
  return COULEURS[somme % COULEURS.length];
};

/// Deux lettres au plus. « Awa Koné » → AK, « Moasko » → M.
export const initiales = (nom = "") =>
  nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((mot) => mot[0].toUpperCase())
    .join("") || "?";

export const Avatar = ({ user, nom, photo, taille = 32, className = "", ...reste }) => {
  const nomAffiche = nom || user?.name || "";
  const image = photo !== undefined ? photo : user?.avatar;
  const style = { width: taille, height: taille };

  if (image) {
    return (
      <img
        className={`cosAvatar ${className}`}
        style={style}
        src={image}
        alt={nomAffiche}
        title={nomAffiche}
        {...reste}
      />
    );
  }

  return (
    <span
      className={`cosAvatar cosAvatarInit ${className}`}
      style={{
        ...style,
        background: couleurDe(nomAffiche),
        // Les initiales doivent tenir quelle que soit la taille demandée,
        // du menu Démarrer (26 px) à l'écran de verrouillage (120 px).
        fontSize: Math.round(taille * 0.4),
      }}
      title={nomAffiche}
      {...reste}
    >
      {initiales(nomAffiche)}
    </span>
  );
};

export default Avatar;
