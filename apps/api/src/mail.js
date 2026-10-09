// Envoi de courriels — par relais SMTP.
//
// CompanyOS n'héberge pas de serveur mail : recevoir du courrier sur un
// VPS est un métier (port 25, réputation d'IP, SPF/DKIM/DMARC), et le
// perdre coûte des invitations qui n'arrivent jamais. On **envoie** via
// le relais SMTP de son choix — Brevo, Resend, un Gmail professionnel,
// ou le postfix de l'entreprise — configuré par variables d'environnement.
//
// Sans configuration SMTP, l'envoi est simplement désactivé : les
// invitations continuent de fonctionner par code, comme avant. Un mail
// qui échoue ne casse jamais l'action qui l'a déclenché.

import net from "node:net";
import nodemailer from "nodemailer";
import { env } from "./env.js";
import { dechiffrer } from "./chiffrement.js";
import { resoudre } from "./web.js";

/// Rend le mot de passe utilisable, qu'il soit chiffré ou non.
///
/// Les réglages d'espace chiffrent désormais le mot de passe SMTP en base
/// (`chiffrer()` produit « v1.… »). Deux cas restent en clair et le
/// resteront : les mots de passe déjà enregistrés avant ce changement, et
/// celui du relais de plateforme, qui vient d'une variable
/// d'environnement. On déchiffre donc **si ça en a la forme**, sinon on
/// prend la valeur telle quelle.
///
/// Un secret chiffré illisible — clé de chiffrement changée — vaut chaîne
/// vide : l'authentification échouera proprement plutôt que d'envoyer le
/// chiffré comme mot de passe au relais.
const motDePasseClair = (pass) => {
  if (!pass) return "";
  if (!String(pass).startsWith("v1.")) return String(pass);
  return dechiffrer(pass) ?? "";
};

/// Fabrique un transporteur SMTP depuis une configuration — celle de la
/// plateforme (variables d'environnement) ou celle d'un espace de travail
/// (réglages de l'app Courrier). Même code pour les deux : un relais est
/// un relais.
export const creerTransporteur = ({ host, port, user, pass }) =>
  host
    ? nodemailer.createTransport({
        host,
        port: Number(port) || 587,
        // 465 = TLS implicite ; 587/25 = STARTTLS négocié.
        secure: Number(port) === 465,
        auth: user ? { user, pass: motDePasseClair(pass) } : undefined,
      })
    : null;

/// Ports d'un relais SMTP. Un autre port n'est pas un relais : c'est une
/// sonde vers un autre service.
export const PORTS_SMTP = [25, 465, 587, 2525];

/// Le relais **d'un espace client**, réglé par son administrateur — donc
/// par n'importe qui pouvant créer un compte.
///
/// Sans garde, viser 10.0.0.5:6379 depuis « Courrier → Réglages » faisait
/// du serveur une sonde du réseau interne, et le message d'erreur
/// (« connexion refusée », bannière du service) en rapportait le
/// résultat. Ici :
///   - seuls les ports SMTP sont admis ;
///   - le nom est résolu à **chaque** envoi, toutes ses adresses doivent
///     être publiques, et la connexion part sur l'IP vérifiée (le nom reste
///     utilisé pour le certificat TLS) — pas de fenêtre pour un DNS
///     changeant ;
///   - un refus du garde ne dit rien de plus que « adresse refusée ».
///
/// `AUTORISER_RESEAU_PRIVE=true` lève le contrôle d'adresse, pour un
/// relais de développement sur la machine locale. Jamais en production.
export const creerTransporteurEspace = (smtp) => {
  if (!smtp?.host) return null;
  const port = Number(smtp.port) || 587;
  const prive = !env.production && process.env.AUTORISER_RESEAU_PRIVE === "true";
  return {
    async sendMail(message) {
      if (!PORTS_SMTP.includes(port)) {
        throw Object.assign(new Error("port"), { code: "EPORT" });
      }
      let host = smtp.host;
      const options = {};
      if (!prive) {
        let adresses;
        try {
          adresses = await resoudre(String(smtp.host).trim());
        } catch {
          throw Object.assign(new Error("adresse"), { code: "EADRESSE" });
        }
        host = adresses[0].address;
        options.tls = { servername: net.isIP(smtp.host) ? undefined : smtp.host };
      }
      const t = creerTransporteur({ ...smtp, host, port });
      Object.assign(t.options, options);
      try {
        return await t.sendMail(message);
      } finally {
        t.close();
      }
    },
    espace: true,
  };
};

/// Les refus du garde, dits en clair. Une fois l'adresse vérifiée
/// publique, la réponse du relais (« 550 boîte inconnue »…) est rendue
/// telle quelle : c'est elle qui classe les rebonds des campagnes.
const erreurEspace = (err) => {
  if (err?.code === "EPORT") {
    return `Port SMTP non autorisé (ports acceptés : ${PORTS_SMTP.join(", ")}).`;
  }
  if (err?.code === "EADRESSE") {
    return "Le relais SMTP doit être une adresse publique joignable sur Internet.";
  }
  return err?.message;
};

const transporteur = creerTransporteur({
  host: env.smtpHost,
  port: env.smtpPort,
  user: env.smtpUser,
  pass: env.smtpPass,
});

export const mailActif = () => transporteur !== null;

/// Envoie par un transporteur donné. Renvoie { envoye, erreur } — jamais
/// d'exception : l'appelant décide quoi dire à l'utilisateur, pas quoi
/// annuler.
export const envoyerVia = async (
  transport,
  { de, a, cc, sujet, texte, html, piecesJointes, entetes },
) => {
  if (!transport) return { envoye: false, erreur: "Aucun relais SMTP configuré." };
  try {
    await transport.sendMail({
      from: de || env.mailFrom,
      to: a,
      cc: cc || undefined,
      subject: sujet,
      text: texte,
      html,
      attachments: piecesJointes,
      // En-têtes propres à l'envoi de masse (List-Unsubscribe…).
      headers: entetes || undefined,
    });
    return { envoye: true };
  } catch (err) {
    console.error(`Envoi du mail à ${a} impossible :`, err.code || "", err.message);
    return { envoye: false, erreur: transport.espace ? erreurEspace(err) : err.message };
  }
};

/// Envoi par le relais de la plateforme (variables d'environnement).
export const envoyerMail = async (message) =>
  (await envoyerVia(transporteur, message)).envoye;

/// Le courriel d'invitation : le code, qui invite, dans quel espace.
/// Texte simple d'abord — les clients mail des PME lisent tout.
export const mailInvitation = ({ espace, invitant, code, role, urlOs }) => {
  const roleLisible = role === "ADMIN" ? "administrateur" : "membre";
  return {
    sujet: `${invitant} vous invite à rejoindre ${espace} sur CompanyOS`,
    texte: [
      `${invitant} vous invite à rejoindre l'espace de travail « ${espace} » sur CompanyOS, en tant que ${roleLisible}.`,
      ``,
      `Votre code d'invitation : ${code}`,
      ``,
      urlOs
        ? `Rendez-vous sur ${urlOs}, choisissez « Rejoindre un espace » et saisissez ce code.`
        : `Ouvrez CompanyOS, choisissez « Rejoindre un espace » et saisissez ce code.`,
      ``,
      `Ce code est personnel et expire dans 14 jours.`,
    ].join("\n"),
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2733">
        <h2 style="font-size:18px">Invitation à rejoindre ${espace}</h2>
        <p>${invitant} vous invite à rejoindre l'espace de travail
        « <b>${espace}</b> » sur CompanyOS, en tant que ${roleLisible}.</p>
        <p style="margin:24px 0;text-align:center">
          <span style="display:inline-block;padding:12px 28px;border-radius:10px;
            background:#eef0fb;color:#4338ca;font-size:22px;font-weight:700;
            letter-spacing:0.12em">${code}</span>
        </p>
        <p>${
          urlOs
            ? `Rendez-vous sur <a href="${urlOs}">${urlOs}</a>, choisissez`
            : "Ouvrez CompanyOS, choisissez"
        } « Rejoindre un espace » et saisissez ce code.</p>
        <p style="color:#6b7684;font-size:13px">Ce code est personnel et
        expire dans 14 jours. Si vous n'attendiez pas cette invitation,
        ignorez ce message.</p>
      </div>`,
  };
};
