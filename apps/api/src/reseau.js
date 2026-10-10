/// Adresse réelle du client derrière le reverse-proxy.
///
/// `TRUST_PROXY=1` était passé tel quel à Fastify. Depuis Fastify 5.12, un
/// nombre seul est **ignoré** (il ne permet pas de vérifier qui parle) : en
/// production, `request.ip` valait l'adresse du proxy pour tout le monde.
/// La limitation de débit comptait alors toute la plateforme comme une
/// seule IP, le journal d'audit notait la même adresse partout — et la
/// détection d'intrusion aurait bloqué tous les clients d'un coup.
///
/// On fait donc confiance aux N derniers relais **à condition** qu'ils
/// soient sur un réseau privé (le réseau Docker du proxy) : un client
/// joint directement depuis Internet ne peut pas maquiller son adresse
/// en envoyant `X-Forwarded-For` lui-même.

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export const estAdressePrivee = (adresse) => {
  let ip = String(adresse || "").trim().toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  const m = IPV4.exec(ip);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return ip === "::1" || /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
};

/// Valeur à donner à l'option `trustProxy` de Fastify.
///   0 / vide        aucun proxy (développement)
///   N (nombre)      N relais de confiance, s'ils sont sur un réseau privé
///   liste d'adresses ou de plages (« 10.0.0.0/8,172.16.0.0/12 ») : telle quelle
export const confianceProxy = (brut) => {
  const valeur = String(brut ?? "").trim();
  if (!valeur || valeur === "0" || valeur === "false") return false;
  if (/^\d+$/.test(valeur)) {
    const sauts = Number(valeur);
    // proxy-addr appelle la fonction pour chaque relais, en partant de
    // l'adresse de la connexion (rang 0).
    return (adresse, rang) => rang < sauts && estAdressePrivee(adresse);
  }
  // `true` reviendrait à croire n'importe quel client : refusé.
  if (valeur === "true") return false;
  return valeur;
};
