// Campagnes — le message par blocs, et son rendu e-mail.
//
// ─────────────────────────────────────────────────────────────────────────
// UN MESSAGE EST UNE PILE DE BLOCS
//
// Titre, texte, image, bouton, produits, deux colonnes, code promo,
// séparateur, réseaux, signature : le geste des éditeurs d'emailing,
// gardé simple. Une pile se range, se duplique, s'enregistre comme modèle,
// et se rend en tableaux HTML — la seule mise en page que tous les clients
// mail respectent.
//
// Le même rendu sert l'aperçu de l'éditeur, l'e-mail de test et l'envoi :
// ce que l'on voit est ce que le client reçoit.
//
// LES LIENS
//
// Chaque lien du message reçoit un numéro, dans l'ordre de lecture
// (`liensDe`). L'envoi remplace chaque adresse par une redirection suivie
// portant ce numéro ; le serveur relit l'adresse dans la campagne, jamais
// dans la requête — aucune redirection ouverte possible.
// ─────────────────────────────────────────────────────────────────────────

import { appliquerModele } from "./courrier.js";

export const TYPES_BLOCS = ["titre", "texte", "image", "bouton", "produits", "colonnes", "promo", "separateur", "reseaux", "signature"];

const nouvelId = () => Math.random().toString(36).slice(2, 10);

/// Un bloc neuf, avec des valeurs qui se lisent déjà bien.
export const blocVide = (type, { langue = "fr" } = {}) => {
  const en = langue === "en";
  const base = { id: nouvelId(), type };
  switch (type) {
    case "titre": return { ...base, texte: en ? "Your headline" : "Votre titre", taille: "grand", align: "gauche" };
    case "texte": return { ...base, texte: en ? "Hello {{contact}},\n\nWrite your message here." : "Bonjour {{contact}},\n\nÉcrivez votre message ici." };
    case "image": return { ...base, url: "", nodeId: "", alt: "", lien: "" };
    case "bouton": return { ...base, label: en ? "Learn more" : "En savoir plus", url: "", align: "centre" };
    case "produits": return { ...base, produits: [], afficherPrix: true };
    case "colonnes": return { ...base, gauche: en ? "**Left column**\nA short text." : "**Colonne de gauche**\nUn texte court.", droite: en ? "**Right column**\nA short text." : "**Colonne de droite**\nUn texte court." };
    case "promo": return { ...base, code: "RENTREE20", texte: en ? "Your code, valid until the end of the month" : "Votre code, valable jusqu'à la fin du mois" };
    case "separateur": return { ...base, style: "ligne" };
    case "reseaux": return { ...base, site: "", whatsapp: "", facebook: "", instagram: "", linkedin: "" };
    case "signature": return { ...base, texte: en ? "Talk soon,\n{{entreprise}}" : "À très vite,\n{{entreprise}}" };
    default: return base;
  }
};

/// Une copie du bloc, avec un nouvel identifiant.
export const dupliquerBloc = (bloc) => ({ ...JSON.parse(JSON.stringify(bloc)), id: nouvelId() });

/// Déplace le bloc `id` d'un cran (`sens` = -1 ou +1).
export const deplacerBloc = (blocs, id, sens) => {
  const i = blocs.findIndex((b) => b.id === id);
  const j = i + sens;
  if (i < 0 || j < 0 || j >= blocs.length) return blocs;
  const copie = [...blocs];
  [copie[i], copie[j]] = [copie[j], copie[i]];
  return copie;
};

/// Les blocs d'une ancienne campagne (texte + bouton), pour l'éditeur.
export const blocsDepuisTexte = (campagne = {}) => {
  const blocs = [];
  if (String(campagne.texte || "").trim()) blocs.push({ id: nouvelId(), type: "texte", texte: campagne.texte });
  if (campagne.cta?.label) blocs.push({ id: nouvelId(), type: "bouton", label: campagne.cta.label, url: campagne.cta.url || "", align: "centre" });
  return blocs;
};

// ---------------------------------------------------------------------------
// Sécurité des valeurs
// ---------------------------------------------------------------------------

/// Échappe pour du texte HTML et pour l'intérieur d'un attribut.
export const echapperHtml = (t) =>
  String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const COULEUR = /^#[0-9a-f]{3,8}$/i;
/// Une couleur, ou la couleur par défaut — jamais autre chose : la valeur
/// finit dans un attribut `style`.
export const couleurSure = (valeur, defaut = "#e8590c") => {
  const brute = String(valeur || "").trim();
  return COULEUR.test(brute) ? brute : defaut;
};

/// Seuls http(s) et mailto/tel sont des liens acceptables dans un mail.
export const urlValide = (valeur) => /^(https?:\/\/[^\s]+|mailto:[^\s]+|tel:[+\d\s]+)$/i.test(String(valeur || "").trim());
const lienSur = (valeur) => (urlValide(valeur) ? echapperHtml(String(valeur).trim()) : "");

/// Un lien WhatsApp depuis un numéro : « +225 07 00 00 00 » → wa.me.
const lienWhatsapp = (numero) => {
  const n = String(numero || "").replace(/[^\d]/g, "");
  return n.length >= 8 ? `https://wa.me/${n}` : "";
};

// ---------------------------------------------------------------------------
// Les liens du message, numérotés dans l'ordre de lecture
// ---------------------------------------------------------------------------

const LIEN_MD = /\[([^\]\n]{1,120})\]\(([^)\s]{1,800})\)/g;

const RESEAUX = [
  { cle: "site", label: "Site web", url: (v) => v },
  { cle: "whatsapp", label: "WhatsApp", url: lienWhatsapp },
  { cle: "facebook", label: "Facebook", url: (v) => v },
  { cle: "instagram", label: "Instagram", url: (v) => v },
  { cle: "linkedin", label: "LinkedIn", url: (v) => v },
];

/// Tous les liens suivis du message : [{ label, url }]. L'indice dans ce
/// tableau est le numéro porté par la redirection. Calculé par le rendu
/// lui-même : un lien qui n'est pas dessiné n'est pas compté, et la
/// numérotation ne peut pas diverger de celle de l'envoi.
export const liensDe = (campagne = {}) => {
  const out = [];
  htmlBlocs(campagne, {
    lien: (i, url, label) => {
      out[i] = { label: label || url, url };
      return url;
    },
    image: (b) => b.url || (b.nodeId ? "https://image.invalid/" : ""),
  });
  return out.filter(Boolean);
};

// ---------------------------------------------------------------------------
// Personnalisation
// ---------------------------------------------------------------------------

const CHAMPS_TEXTE = ["texte", "label", "alt", "gauche", "droite", "code"];

/// La campagne avec les variables remplacées dans l'objet, l'aperçu et
/// tous les textes des blocs. Les adresses des liens ne sont pas touchées :
/// une variable dans une URL fabriquerait des liens imprévisibles.
///
/// Dans les textes mis en forme, la valeur d'une variable est neutralisée :
/// un nom saisi dans le formulaire public comme `[Cliquez](https://…)`
/// devenait sinon un vrai lien suivi — et décalait la numérotation de tous
/// les liens du message pour ce destinataire.
const neutraliser = (variables) =>
  Object.fromEntries(
    Object.entries(variables).map(([k, v]) => [
      k,
      typeof v === "string"
        ? v.replace(/\[/g, "(").replace(/\]/g, ")").replace(/[\r\n]+/g, " ")
        : v,
    ]),
  );

export const personnaliser = (campagne = {}, variables = {}) => {
  const surs = neutraliser(variables);
  return {
    ...campagne,
    sujet: appliquerModele(campagne.sujet, variables),
    apercu: appliquerModele(campagne.apercu, variables),
    texte: appliquerModele(campagne.texte, surs),
    blocs: (campagne.blocs || []).map((b) => {
      const out = { ...b };
      for (const k of CHAMPS_TEXTE) if (typeof out[k] === "string") out[k] = appliquerModele(out[k], surs);
      return out;
    }),
  };
};

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

const POLICE = "Segoe UI,Helvetica,Arial,sans-serif";
const ENCRE = "#26313d";

/// Le texte riche minimal : **gras**, [lien](https://…), listes « - ».
/// Tout est échappé d'abord ; seuls ces trois motifs redeviennent du HTML.
const enrichir = (texte, ctx, couleur) => {
  const paragraphes = String(texte || "").split(/\n{2,}/);
  return paragraphes
    .map((p) => {
      const lignes = p.split("\n");
      const ligne = (l) => {
        let h = "";
        let dernier = 0;
        for (const m of l.matchAll(LIEN_MD)) {
          h += gras(echapperHtml(l.slice(dernier, m.index)));
          if (urlValide(m[2])) {
            const href = ctx.lien(ctx.compteur++, m[2], m[1]);
            h += `<a href="${echapperHtml(href)}" style="color:${couleur};font-weight:600">${gras(echapperHtml(m[1]))}</a>`;
          } else {
            h += echapperHtml(m[0]);
          }
          dernier = m.index + m[0].length;
        }
        return h + gras(echapperHtml(l.slice(dernier)));
      };
      if (lignes.every((l) => /^\s*[-•]\s+/.test(l))) {
        return `<ul style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.65;color:${ENCRE}">${lignes
          .map((l) => `<li>${ligne(l.replace(/^\s*[-•]\s+/, ""))}</li>`)
          .join("")}</ul>`;
      }
      return `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:${ENCRE}">${lignes.map(ligne).join("<br>")}</p>`;
    })
    .join("");
};
const gras = (h) => h.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

const alignDe = (a) => (a === "centre" ? "center" : a === "droite" ? "right" : "left");
const ligne = (contenu, padding = "8px 32px") => `<tr><td style="padding:${padding}">${contenu}</td></tr>`;

const rendreBloc = (b, ctx) => {
  const couleur = ctx.couleur;
  const lien = (url, label) => echapperHtml(ctx.lien(ctx.compteur++, url, label));
  switch (b.type) {
    case "titre": {
      const taille = b.taille === "moyen" ? 20 : 26;
      return ligne(`<h1 style="margin:6px 0 4px;font-family:${POLICE};font-size:${taille}px;line-height:1.25;color:#111827;text-align:${alignDe(b.align)}">${echapperHtml(b.texte)}</h1>`, "18px 32px 4px");
    }
    case "texte":
      return ligne(enrichir(b.texte, ctx, couleur));
    case "signature":
      return ligne(enrichir(b.texte, ctx, couleur), "4px 32px 16px");
    case "image": {
      const src = lienSur(ctx.image(b));
      if (!src) return "";
      const img = `<img src="${src}" alt="${echapperHtml(b.alt)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:8px">`;
      return ligne(urlValide(b.lien) ? `<a href="${lien(b.lien, b.alt || "Image")}">${img}</a>` : img);
    }
    case "bouton": {
      if (!b.label || !urlValide(b.url)) return "";
      const fond = couleurSure(b.couleur, couleur);
      return ligne(`<table role="presentation" cellpadding="0" cellspacing="0" align="${alignDe(b.align || "centre")}" style="margin:10px auto"><tr><td style="border-radius:9px;background:${fond}">
<a href="${lien(b.url, b.label)}" style="display:inline-block;padding:13px 30px;font-family:${POLICE};color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">${echapperHtml(b.label)}</a></td></tr></table>`);
    }
    case "produits": {
      const items = (b.produits || []).slice(0, 6);
      if (!items.length) return "";
      const cellules = items.map((p) => {
        const nom = `<b style="font-size:14px;color:#111827">${echapperHtml(p.nom)}</b>`;
        const prix = b.afficherPrix !== false && p.prix ? `<div style="margin-top:4px;font-size:15px;font-weight:bold;color:${couleur}">${echapperHtml(p.prix)}</div>` : "";
        const voir = urlValide(p.url) ? `<div style="margin-top:8px"><a href="${lien(p.url, p.nom)}" style="font-size:13px;font-weight:600;color:${couleur}">${echapperHtml(p.lienLabel || "Voir")}</a></div>` : "";
        return `<td width="50%" valign="top" style="padding:6px"><div style="padding:14px;border:1px solid #edf0f3;border-radius:8px;font-family:${POLICE}">${nom}${prix}${voir}</div></td>`;
      });
      const rangs = [];
      for (let i = 0; i < cellules.length; i += 2) rangs.push(`<tr>${cellules[i]}${cellules[i + 1] || '<td width="50%"></td>'}</tr>`);
      return ligne(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rangs.join("")}</table>`, "6px 26px");
    }
    case "colonnes": {
      const g = enrichir(b.gauche, ctx, couleur);
      const d = enrichir(b.droite, ctx, couleur);
      return ligne(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="50%" valign="top" style="padding-right:10px">${g}</td><td width="50%" valign="top" style="padding-left:10px">${d}</td></tr></table>`);
    }
    case "promo":
      if (!b.code) return "";
      return ligne(`<div style="padding:16px;border:2px dashed ${couleur};border-radius:10px;text-align:center;font-family:${POLICE}">
<div style="font-size:24px;font-weight:bold;letter-spacing:.12em;color:${couleur}">${echapperHtml(b.code)}</div>
${b.texte ? `<div style="margin-top:6px;font-size:13px;color:#4b5563">${echapperHtml(b.texte)}</div>` : ""}</div>`);
    case "separateur":
      return b.style === "espace" ? ligne("&nbsp;", "10px 32px") : ligne('<div style="border-top:1px solid #edf0f3;font-size:0;line-height:0">&nbsp;</div>', "12px 32px");
    case "reseaux": {
      const liens = RESEAUX.map((r) => ({ label: r.label, url: r.url(b[r.cle]) })).filter((l) => urlValide(l.url));
      if (!liens.length) return "";
      return ligne(`<p style="margin:0;text-align:center;font-family:${POLICE};font-size:14px">${liens
        .map((l) => `<a href="${lien(l.url, l.label)}" style="color:${couleur};font-weight:600;text-decoration:none">${echapperHtml(l.label)}</a>`)
        .join(' <span style="color:#c4cad2">·</span> ')}</p>`);
    }
    default:
      return "";
  }
};

/// Le rendu d'un seul bloc, en tableau autonome — l'éditeur l'affiche sur
/// son plan de travail. `debut` : le numéro de son premier lien ; renvoie
/// aussi les numéros de ses liens (la carte des clics s'en sert).
export const htmlBloc = (bloc, { couleur = "#e8590c", image = (b) => b.url, debut = 0 } = {}) => {
  const liens = [];
  const ctx = {
    couleur: couleurSure(couleur),
    image,
    compteur: debut,
    lien: (i, url) => {
      liens.push(i);
      return url;
    },
  };
  const rangs = rendreBloc(bloc, ctx);
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${POLICE}">${rangs}</table>`,
    liens,
    suivant: ctx.compteur,
  };
};

const PIED = {
  fr: (entreprise) => `Vous recevez ce message parce que vous êtes en relation avec ${entreprise}.`,
  en: (entreprise) => `You are receiving this email because you are in touch with ${entreprise}.`,
};
const DESABO = { fr: "Se désinscrire", en: "Unsubscribe" };

/// L'e-mail complet. Options :
///   entreprise, pied (mentions légales), logo, pixel, lienDesinscription ;
///   lien(i, url) : l'adresse posée pour le i-ème lien (suivi) ;
///   image(bloc) : l'adresse publique d'une image du Cloud.
export const htmlBlocs = (campagne = {}, options = {}) => {
  const {
    entreprise = "",
    lien = (_i, url) => url,
    image = (b) => b.url,
    lienDesinscription = "",
    pixel = "",
    logo = "",
    pied = "",
  } = options;
  const langue = campagne.langue === "en" ? "en" : "fr";
  const couleur = couleurSure(campagne.couleur);
  const ctx = { couleur, lien, image, compteur: 0 };
  const blocs = Array.isArray(campagne.blocs) && campagne.blocs.length ? campagne.blocs : blocsDepuisTexte(campagne);
  const corps = blocs.map((b) => rendreBloc(b, ctx)).join("\n");
  const preheader = campagne.apercu
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${echapperHtml(campagne.apercu)}</div>`
    : "";
  const desabo = lienSur(lienDesinscription);
  const pix = lienSur(pixel);
  const logoSur = lienSur(logo);

  return `<!doctype html><html lang="${langue}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${echapperHtml(campagne.sujet)}</title></head>
<body style="margin:0;padding:0;background:#f2f4f7">${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;padding:26px 12px">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:${POLICE}">
  <tr><td style="background:${couleur};padding:20px 32px">
    ${logoSur ? `<img src="${logoSur}" alt="" height="36" style="height:36px;max-width:160px;vertical-align:middle;margin-right:12px;border-radius:6px;background:#ffffff">` : ""}<span style="color:#ffffff;font-size:19px;font-weight:bold;letter-spacing:.02em;vertical-align:middle">${echapperHtml(entreprise)}</span>
  </td></tr>
  <tr><td style="height:12px;font-size:0;line-height:0">&nbsp;</td></tr>
  ${corps}
  <tr><td style="padding:18px 32px 24px;border-top:1px solid #edf0f3">
    ${pied ? `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#8a94a1">${echapperHtml(pied)}</p>` : ""}
    <p style="margin:0;font-size:12px;line-height:1.6;color:#8a94a1">${echapperHtml(PIED[langue](entreprise))}
      ${desabo ? `<a href="${desabo}" style="color:#8a94a1">${DESABO[langue]}</a>` : ""}</p>
  </td></tr>
</table>
${pix ? `<img src="${pix}" width="1" height="1" alt="" style="display:block">` : ""}
</td></tr></table></body></html>`;
};

/// La version texte : les clients mail austères, et les filtres anti-spam,
/// qui se méfient d'un message sans elle.
export const texteDe = (campagne = {}, { lien = (_i, url) => url, pied = "", lienDesinscription = "", entreprise = "" } = {}) => {
  const langue = campagne.langue === "en" ? "en" : "fr";
  const blocs = Array.isArray(campagne.blocs) && campagne.blocs.length ? campagne.blocs : blocsDepuisTexte(campagne);
  // Chaque adresse reprend le numéro que le rendu HTML lui a donné : la
  // version texte et la version HTML comptent les mêmes clics.
  const liste = liensDe(campagne);
  const pris = new Set();
  const suivi = (url) => {
    const i = liste.findIndex((l, j) => l.url === url && !pris.has(j));
    if (i < 0) return url;
    pris.add(i);
    return lien(i, url);
  };
  const avecLiens = (t) => String(t || "").replace(LIEN_MD, (tout, label, url) => (urlValide(url) ? `${label} (${suivi(url)})` : tout)).replace(/\*\*([^*]+)\*\*/g, "$1");
  const morceaux = blocs.map((b) => {
    switch (b.type) {
      case "titre": return String(b.texte || "").toUpperCase();
      case "texte": case "signature": return avecLiens(b.texte);
      case "colonnes": return `${avecLiens(b.gauche)}\n\n${avecLiens(b.droite)}`;
      case "image": return urlValide(b.lien) ? `${b.alt || "Image"} : ${suivi(b.lien)}` : "";
      case "bouton": return urlValide(b.url) && b.label ? `${b.label} : ${suivi(b.url)}` : "";
      case "produits": return (b.produits || []).slice(0, 6).map((p) => [p.nom, b.afficherPrix !== false ? p.prix : "", urlValide(p.url) ? suivi(p.url) : ""].filter(Boolean).join(" — ")).join("\n");
      case "promo": return b.code ? `${b.code}${b.texte ? ` — ${b.texte}` : ""}` : "";
      case "separateur": return "—";
      case "reseaux": return RESEAUX.map((r) => ({ label: r.label, url: r.url(b[r.cle]) })).filter((l) => urlValide(l.url)).map((l) => `${l.label} : ${suivi(l.url)}`).join("\n");
      default: return "";
    }
  });
  const fin = langue === "en"
    ? `To stop receiving these emails from ${entreprise}:`
    : `Pour ne plus recevoir ces messages de ${entreprise} :`;
  return `${morceaux.filter(Boolean).join("\n\n")}\n\n—\n${pied}${lienDesinscription ? `\n${fin}\n${lienDesinscription}` : ""}`;
};

/// Les contrôles de contenu avant l'envoi : [{ id, ok, params }]. Les
/// libellés sont traduits par l'écran.
export const verificationsContenu = (campagne = {}) => {
  const blocs = campagne.blocs || [];
  const images = blocs.filter((b) => b.type === "image");
  const boutons = blocs.filter((b) => b.type === "bouton");
  const html = htmlBlocs(campagne, { lienDesinscription: "https://x.invalid/d" });
  const poids = Math.round(new TextEncoder().encode(html).length / 1024);
  return [
    { id: "contenu", ok: blocs.some((b) => ["texte", "titre"].includes(b.type) && String(b.texte || "").trim()) },
    { id: "boutons", ok: boutons.every((b) => b.label && urlValide(b.url)), facultatif: !boutons.length },
    { id: "images", ok: images.every((b) => (b.url || b.nodeId) && String(b.alt || "").trim()), facultatif: !images.length, conseil: true },
    { id: "poids", ok: poids < 100, params: { ko: poids }, conseil: true },
  ];
};
