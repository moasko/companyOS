// Campagnes — les modèles : trois points de départ prêts à l'emploi, puis
// ceux de l'entreprise (mise en page complète, réutilisable).

import React, { useState } from "react";
import { Icon } from "../../../../utils/general";
import { api } from "../../../../api/client";
import { modal } from "../../../modalRequest";
import * as D from "@companyos/shared/campagnes";
import { Bouton, Carte, Entete, Etiquette, useC } from "../commun";
import { EditeurBlocs } from "./EditeurBlocs";

/// Les modèles de départ, dans la langue de l'écran.
const departs = (t, langue) => {
  const b = (type, patch = {}) => ({ ...D.blocVide(type, { langue }), ...patch });
  return [
    {
      id: "lettre",
      nom: t("depart_lettre"),
      sujet: t("departSujet_lettre"),
      apercu: t("departApercu_lettre"),
      couleur: "#1d4ed8",
      blocs: [b("titre", { texte: t("departTitre_lettre") }), b("texte", { texte: t("departTexte_lettre") }), b("colonnes"), b("bouton", { label: t("departBouton_lettre") }), b("separateur"), b("signature")],
    },
    {
      id: "promo",
      nom: t("depart_promo"),
      sujet: t("departSujet_promo"),
      apercu: t("departApercu_promo"),
      couleur: "#c2410c",
      blocs: [b("titre", { texte: t("departTitre_promo"), align: "centre" }), b("image"), b("texte", { texte: t("departTexte_promo") }), b("produits"), b("promo"), b("bouton", { label: t("departBouton_promo") }), b("signature")],
    },
    {
      id: "invitation",
      nom: t("depart_invitation"),
      sujet: t("departSujet_invitation"),
      apercu: t("departApercu_invitation"),
      couleur: "#047857",
      blocs: [b("titre", { texte: t("departTitre_invitation") }), b("texte", { texte: t("departTexte_invitation") }), b("colonnes", { gauche: t("departGauche_invitation"), droite: t("departDroite_invitation") }), b("bouton", { label: t("departBouton_invitation") }), b("reseaux"), b("signature")],
    },
  ];
};

export const Modeles = () => {
  const s = useC();
  const { t, langue, modeles, anciensModeles, peutEcrire, aller, tache, rafraichir, dateCourte } = s;
  const [edition, setEdition] = useState(null); // { id, data }

  const utiliser = (m) =>
    aller("editeur", { initial: { ...D.CAMPAGNE_VIDE, nom: m.nom, sujet: m.sujet || "", apercu: m.apercu || "", couleur: m.couleur || D.CAMPAGNE_VIDE.couleur, langue: m.langue || langue, blocs: (m.blocs || []).map(D.dupliquerBloc) }, cle: Date.now(), etape: "audience" });

  const supprimer = async (m) => {
    if (!(await modal.confirm({ title: t("supprimerModeleTitre"), message: t("supprimerModeleMessage", { nom: m.data.nom }), confirmLabel: t("supprimer"), danger: true }))) return;
    await tache(async () => { await api.records.remove("campagnes", "modeles", m.id); await rafraichir(); });
  };

  const enregistrer = () =>
    tache(async () => {
      await api.records.update("campagnes", "modeles", edition.id, edition.data);
      await rafraichir();
      setEdition(null);
    });

  if (edition) {
    return (
      <div className="cmpVue cmpVueEditeur">
        <Entete titre={edition.data.nom} sous={t("modifierModele")} retour={{ action: () => setEdition(null), label: t("navModeles") }}>
          <label className="cmpNomInterne"><span>{t("nomModele")}</span><input value={edition.data.nom} onChange={(e) => setEdition((x) => ({ ...x, data: { ...x.data, nom: e.target.value } }))} /></label>
          <Bouton variante="principal" disabled={!peutEcrire} onClick={enregistrer}>{t("enregistrer")}</Bouton>
        </Entete>
        <EditeurBlocs message={edition.data} onChange={(p) => setEdition((x) => ({ ...x, data: { ...x.data, ...p } }))} />
      </div>
    );
  }

  return (
    <div className="cmpVue">
      <Entete titre={t("navModeles")} sous={t("sousModeles")} />
      <div className="cmpConteneur">
        <Carte titre={t("pointsDepart")}>
          <div className="cmpModeles">
            {departs(t, langue).map((m) => (
              <div key={m.id} className="cmpModele">
                <Miniature couleur={m.couleur} blocs={m.blocs} />
                <b>{m.nom}</b>
                <small>{m.sujet}</small>
                <Bouton variante="principal" disabled={!peutEcrire} onClick={() => utiliser(m)}>{t("utiliser")}</Bouton>
              </div>
            ))}
          </div>
        </Carte>
        <Carte titre={t("vosModeles")} aide={t("vosModelesAide")}>
          {modeles.length || anciensModeles.length ? (
            <div className="cmpModeles">
              {modeles.map((m) => (
                <div key={m.id} className="cmpModele">
                  <Miniature couleur={m.data.couleur} blocs={m.data.blocs || []} />
                  <b>{m.data.nom}</b>
                  <small>{m.data.sujet} · {dateCourte(m.createdAt)}</small>
                  <span className="cmpBoutonsLigne">
                    <Bouton variante="principal" disabled={!peutEcrire} onClick={() => utiliser(m.data)}>{t("utiliser")}</Bouton>
                    <Bouton disabled={!peutEcrire} onClick={() => setEdition({ id: m.id, data: { ...m.data } })}>{t("modifier")}</Bouton>
                    {peutEcrire ? <button type="button" className="cmpIcone" aria-label={t("supprimer")} onClick={() => supprimer(m)}><Icon fafa="faTrashCan" width={12} /></button> : null}
                  </span>
                </div>
              ))}
              {anciensModeles.map((m) => (
                <div key={m.id} className="cmpModele">
                  <Miniature couleur="#6b7280" blocs={D.blocsDepuisTexte({ texte: m.data.texte })} />
                  <b>{m.data.nom}</b>
                  <small><Etiquette>{t("modeleCourrier")}</Etiquette> {m.data.sujet}</small>
                  <Bouton disabled={!peutEcrire} onClick={() => utiliser({ nom: m.data.nom, sujet: m.data.sujet, blocs: D.blocsDepuisTexte({ texte: m.data.texte }) })}>{t("utiliser")}</Bouton>
                </div>
              ))}
            </div>
          ) : <p className="cmpAide">{t("aucunModeleD")}</p>}
        </Carte>
      </div>
    </div>
  );
};

/// Une vignette : la silhouette des blocs du message.
const Miniature = ({ couleur, blocs }) => (
  <div className="cmpMiniature" aria-hidden="true">
    <span className="cmpMiniTete" style={{ background: D.couleurSure(couleur) }} />
    {blocs.slice(0, 7).map((b) => <span key={b.id} className="cmpMiniBloc" data-type={b.type} style={b.type === "bouton" ? { background: D.couleurSure(couleur) } : undefined} />)}
  </div>
);
