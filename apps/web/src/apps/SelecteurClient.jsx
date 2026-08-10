// Sélecteur de client — le même dans toute l'entreprise.
//
// Même raisonnement que le sélecteur de produit : au-delà de trente
// fiches, une liste déroulante n'est plus utilisable, et on veut voir la
// ville et le statut avant de choisir.
//
//   const c = await choisirClient();
//   if (c) remplirDestinataire(c);
//
// Il partage la feuille de style du sélecteur de produit : deux boîtes qui
// font la même chose doivent se ressembler, sinon l'utilisateur réapprend
// à chaque fois.

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../utils/general";
import { modal } from "./modalRequest";
import { chargerReferentiel, enregistrerSelecteur, filtrerClients } from "./referentiel";
import "./selecteur.scss";

const STATUTS = {
  prospect: { label: "Prospect", ton: "info" },
  actif: { label: "Client actif", ton: "ok" },
  inactif: { label: "Inactif", ton: "idle" },
};

/// Initiales sur pastille colorée : sans photo, c'est ce qui permet de
/// balayer une liste des yeux plutôt que de la lire ligne à ligne.
const initiale = (c) =>
  (c.data.entreprise || c.data.nom || "?").trim().charAt(0).toUpperCase();

const Selecteur = ({ titre, close }) => {
  const [donnees, setDonnees] = useState(null);
  const [requete, setRequete] = useState("");
  const [statut, setStatut] = useState(null);

  useEffect(() => {
    let vivant = true;
    chargerReferentiel().then((d) => vivant && setDonnees(d));
    return () => {
      vivant = false;
    };
  }, []);

  const visibles = useMemo(() => {
    if (!donnees) return [];
    return filtrerClients(donnees.clients, requete).filter(
      (c) => !statut || c.data.statut === statut,
    );
  }, [donnees, requete, statut]);

  const compte = (id) =>
    (donnees?.clients || []).filter((c) => c.data.statut === id).length;

  return (
    <div className="selProduit">
      <div className="selTete">
        <span className="selTitre">{titre || "Choisir un client"}</span>
        <Icon fafa="faXmark" width={12} onClick={() => close(null)} />
      </div>

      <div className="selBarre">
        <Icon fafa="faMagnifyingGlass" width={11} />
        <input
          type="text"
          autoFocus
          placeholder="Nom, entreprise, ville, téléphone…"
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && visibles.length === 1) close(visibles[0]);
            if (e.key === "Escape") close(null);
          }}
        />
      </div>

      <div className="selCorps">
        <aside className="selArbre cosScroll">
          <div
            className="selCat handcr"
            data-actif={statut === null}
            onClick={() => setStatut(null)}
          >
            <span className="selCatChevron" />
            <span className="selCatNom">Tous les clients</span>
          </div>
          {Object.entries(STATUTS).map(([id, s]) => (
            <div
              key={id}
              className="selCat handcr"
              data-actif={statut === id}
              onClick={() => setStatut(id)}
            >
              <span className="selCatChevron" />
              <span className="selCatNom">{s.label}</span>
              <span className="selCompte">{compte(id)}</span>
            </div>
          ))}
        </aside>

        <div className="selGrille cosScroll">
          {!donnees ? (
            <div className="selVide">Chargement du fichier client…</div>
          ) : !visibles.length ? (
            <div className="selVide">
              <Icon fafa="faUsers" width={22} />
              <span>
                {donnees.clients.length
                  ? "Aucun client pour cette recherche."
                  : "Aucun client enregistré. Créez la première fiche depuis le CRM."}
              </span>
            </div>
          ) : (
            visibles.map((c) => {
              const s = STATUTS[c.data.statut] || STATUTS.prospect;
              return (
                <div key={c.id} className="selCarte handcr" onClick={() => close(c)}>
                  <div className="selVignette selVignetteInit">{initiale(c)}</div>
                  <div className="selInfo">
                    <div className="selNom">
                      {c.data.entreprise || c.data.nom || "Sans nom"}
                    </div>
                    <div className="selMeta">
                      {[c.data.entreprise ? c.data.nom : null, c.data.ville, c.data.telephone]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="selDroite">
                    <div className="selStock" data-ton={s.ton}>
                      {s.label}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

/// Monté une fois par le shell.
export const HoteSelecteurClient = () => {
  useEffect(() => {
    enregistrerSelecteur("client", (options) =>
      modal.open({
        nu: true,
        render: ({ close }) => <Selecteur {...options} close={close} />,
      }),
    );
    return () => enregistrerSelecteur("client", null);
  }, []);

  return null;
};

export default HoteSelecteurClient;
