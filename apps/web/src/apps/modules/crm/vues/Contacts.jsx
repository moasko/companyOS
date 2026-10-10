// Contacts : tous les interlocuteurs, tous comptes confondus — pour
// retrouver « la comptable de la clinique » sans savoir dans quel compte
// elle est rangée.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../../utils/general";
import { nomDe } from "../domaine";
import { Initiales, lienTel, Pastille, Vide } from "../commun";

const TON_ROLE = { decideur: "info", facturation: "ok", influenceur: "violet" };

export const Contacts = ({ t, d, actions, clientDe, telephone }) => {
  const [requete, setRequete] = useState("");
  const [role, setRole] = useState("");

  const liste = useMemo(() => {
    const q = requete.trim().toLowerCase();
    return d.contacts
      .filter((x) => !role || x.data.role === role)
      .filter((x) => {
        if (!q) return true;
        const compte = clientDe(x.data.clientId);
        return [x.data.prenom, x.data.nom, x.data.poste, x.data.email, x.data.telephone, compte ? nomDe(compte) : ""]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => `${a.data.nom} ${a.data.prenom}`.localeCompare(`${b.data.nom} ${b.data.prenom}`));
  }, [d.contacts, requete, role, clientDe]);

  return (
    <div className="crmPage">
      <header className="crmEntete">
        <div>
          <h1>{t("navContacts")}</h1>
          <p className="crmSous">{t("nbContacts", { n: liste.length })}</p>
        </div>
        <div className="crmFiltres">
          <label className="crmRecherche">
            <Icon fafa="faMagnifyingGlass" width={12} />
            <input type="search" value={requete} onChange={(e) => setRequete(e.target.value)} placeholder={t("rechercher")} aria-label={t("rechercher")} />
          </label>
          <select className="crmChoix" value={role} onChange={(e) => setRole(e.target.value)} aria-label={t("role")}>
            <option value="">{t("role")} : {t("tous")}</option>
            {["decideur", "influenceur", "utilisateur", "facturation", "technique", "autre"].map((r) => (
              <option key={r} value={r}>{t(`role_${r}`)}</option>
            ))}
          </select>
        </div>
      </header>

      {!liste.length ? (
        <Vide icone="faAddressBook">{t("aucunContactListe")}</Vide>
      ) : (
        <ul className={telephone ? "crmCartesListe" : "crmGrilleContacts"}>
          {liste.map((x) => {
            const nom = [x.data.prenom, x.data.nom].filter(Boolean).join(" ");
            const compte = clientDe(x.data.clientId);
            return (
              <li key={x.id} className="crmCarteContact">
                <Initiales nom={nom} taille={38} />
                <button type="button" className="crmLigneCorps" onClick={() => compte && actions.ouvrirCompte(compte.id)}>
                  <strong>{nom}</strong>
                  <span className="crmMuted">{[x.data.poste, compte ? nomDe(compte) : ""].filter(Boolean).join(" · ")}</span>
                  <span><Pastille ton={TON_ROLE[x.data.role] || "idle"}>{t(`role_${x.data.role || "autre"}`)}</Pastille></span>
                </button>
                {x.data.telephone ? (
                  <a className="crmIb" href={lienTel(x.data.telephone)} aria-label={`${t("appeler")} ${nom}`} onClick={() => compte && setTimeout(() => actions.compteRendu(compte.id, x.id), 400)}>
                    <Icon fafa="faPhone" width={12} />
                  </a>
                ) : null}
                {x.data.email ? (
                  <button type="button" className="crmIb" aria-label={`${t("ecrire")} ${nom}`} onClick={() => actions.ecrire(compte, x)}>
                    <Icon fafa="faEnvelope" width={12} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
