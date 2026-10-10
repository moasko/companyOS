import React, { useEffect, useState } from "react";
import { api } from "../../../../api/client";
import { modal } from "../../../../apps/modalRequest";
import { Row, Toggle } from "./commun";

/// Authentification unique (OpenID Connect) de l'espace : Microsoft Entra
/// ID, Google Workspace, Okta, Keycloak… Le propriétaire configure ; les
/// administrateurs consultent.
export const ReglageSso = ({ session, flash }) => {
  const proprietaire = session.user?.role === "OWNER";
  const [etat, setEtat] = useState(null);
  const [form, setForm] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [edition, setEdition] = useState(false);

  const charger = async () => {
    try {
      const r = await api.configSso();
      setEtat(r);
      const c = r.config || {};
      setForm({
        emetteur: c.emetteur || "",
        clientId: c.clientId || "",
        secret: "",
        domaines: (c.domaines || []).join(", "),
        obligatoire: !!c.obligatoire,
        creerComptes: !!c.creerComptes,
        actif: c.actif !== false,
      });
    } catch (err) {
      flash(err.message);
    }
  };
  useEffect(() => {
    charger();
    // Chargé une fois à l'ouverture de la section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!etat || !form) return null;
  const c = etat.config;
  const champ = (cle) => (e) => setForm((f) => ({ ...f, [cle]: e.target.value }));

  const enregistrer = async () => {
    setOccupe(true);
    try {
      await api.enregistrerSso({ ...form, ...(form.secret ? {} : { secret: undefined }) });
      flash("Authentification unique enregistrée");
      setEdition(false);
      await charger();
    } catch (err) {
      flash(err.message);
    } finally {
      setOccupe(false);
    }
  };

  const supprimer = async () => {
    const ok = await modal.confirm({
      title: "Retirer l'authentification unique",
      message: "Les membres se connecteront de nouveau avec leur mot de passe (ils devront peut-être le réinitialiser).",
      confirmLabel: "Retirer",
      danger: true,
    });
    if (!ok) return;
    await api.supprimerSso().catch((e) => flash(e.message));
    await charger();
  };

  return (
    <>
      <div className="setSubTitle">Authentification unique (SSO)</div>
      <p className="setHint">
        Vos salariés se connectent avec leur compte d'entreprise (Microsoft, Google, Okta…) : un départ désactivé chez le
        fournisseur ferme aussi l'accès à CompanyOS. Protocole OpenID Connect.
      </p>
      {!edition ? (
        <div className="setList">
          <Row
            title={c ? (c.actif ? "Activée" : "Configurée, désactivée") : "Non configurée"}
            desc={
              c
                ? `${c.emetteur} · domaines : ${c.domaines.join(", ")}${c.obligatoire ? " · obligatoire (sauf propriétaire)" : ""}${c.creerComptes ? " · comptes créés à la première connexion" : ""}`
                : "Connectez votre fournisseur d'identité pour une connexion unique et centralisée."
            }
          >
            {proprietaire ? (
              <span style={{ display: "inline-flex", gap: 8 }}>
                <div className="setBtnGhost handcr" onClick={() => setEdition(true)}>
                  {c ? "Modifier" : "Configurer"}
                </div>
                {c ? (
                  <div className="setBtnGhost setDanger handcr" onClick={supprimer}>
                    Retirer
                  </div>
                ) : null}
              </span>
            ) : null}
          </Row>
        </div>
      ) : (
        <div className="setCard setSsoForm">
          <p className="setHint">
            Chez votre fournisseur, déclarez une application « Web » avec cette adresse de redirection :
            <br />
            <code className="setCode">{etat.urlRetour}</code>
          </p>
          <label>
            <span>Émetteur (issuer)</span>
            <input className="setInput" value={form.emetteur} onChange={champ("emetteur")} placeholder="https://login.microsoftonline.com/<id-locataire>/v2.0" />
          </label>
          <label>
            <span>Identifiant client</span>
            <input className="setInput" value={form.clientId} onChange={champ("clientId")} />
          </label>
          <label>
            <span>Secret client {c?.secretDefini ? "(laisser vide pour garder l'actuel)" : ""}</span>
            <input className="setInput" type="password" autoComplete="new-password" value={form.secret} onChange={champ("secret")} />
          </label>
          <label>
            <span>Domaines de messagerie (séparés par des virgules)</span>
            <input className="setInput" value={form.domaines} onChange={champ("domaines")} placeholder="entreprise.ci, filiale.ci" />
          </label>
          <Row title="Activer" desc="Le bouton « Authentification unique » mène à votre fournisseur.">
            <Toggle on={form.actif} onClick={() => setForm((f) => ({ ...f, actif: !f.actif }))} />
          </Row>
          <Row title="Obligatoire" desc="Plus de connexion par mot de passe pour les membres (le propriétaire garde un accès de secours).">
            <Toggle on={form.obligatoire} onClick={() => setForm((f) => ({ ...f, obligatoire: !f.obligatoire }))} />
          </Row>
          <Row title="Créer les comptes à la première connexion" desc="Sinon, seules les personnes invitées peuvent entrer.">
            <Toggle on={form.creerComptes} onClick={() => setForm((f) => ({ ...f, creerComptes: !f.creerComptes }))} />
          </Row>
          <div className="setActionsRow">
            <div className="setPrimary handcr" data-off={occupe} onClick={enregistrer}>
              {occupe ? "Vérification du fournisseur…" : "Enregistrer"}
            </div>
            <div className="setBtnGhost handcr" onClick={() => setEdition(false)}>
              Annuler
            </div>
          </div>
        </div>
      )}
    </>
  );
};
