import React from "react";
import { Icon } from "../../../../utils/general";
import { Avatar } from "../../../../apps/Avatar";
import { ROLES } from "./commun";

export const SectionCompte = ({
  section,
  session,
  busy,
  changerPhoto,
  retirerPhoto,
  nomProfil,
  setNomProfil,
  enregistrerProfil,
  mdp,
  setMdp,
  changerMotDePasse,
}) => (
  <section className="setSection" data-hidden={section !== "compte"}>
    <h2>Compte</h2>
    <p className="setHint">Vos informations personnelles</p>

    <div className="setCard setAccountCard">
      <div className="setPhoto">
        <Avatar user={session.user} taille={56} />
        <span
          className="setPhotoBtn handcr"
          title="Changer la photo"
          onClick={changerPhoto}
        >
          <Icon fafa="faCamera" width={10} />
        </span>
      </div>
      <div>
        <div className="setSysName">{session.user?.name || "—"}</div>
        <div className="setSysMeta">{session.user?.email || "—"}</div>
        <div className="setSysMeta">
          {ROLES[session.user?.role] || session.user?.role}
        </div>
        <div className="setActionsRow mt-2">
          <div className="setBtnGhost handcr" onClick={changerPhoto}>
            {session.user?.avatar ? "Changer la photo" : "Ajouter une photo"}
          </div>
          {session.user?.avatar ? (
            <div
              className="setBtnGhost setDanger handcr"
              onClick={retirerPhoto}
            >
              Retirer
            </div>
          ) : null}
        </div>
      </div>
    </div>

    <div className="setSubTitle">Nom affiché</div>
    <div className="setInline">
      <input
        type="text"
        value={nomProfil}
        onChange={(e) => setNomProfil(e.target.value)}
      />
      <div
        className="setPrimary handcr"
        data-off={busy || !nomProfil.trim()}
        onClick={enregistrerProfil}
      >
        Enregistrer
      </div>
    </div>

    <div className="setSubTitle">Mot de passe</div>
    <div className="setGrid">
      <label className="setField">
        <span className="setLabel">Mot de passe actuel</span>
        <input
          type="password"
          value={mdp.current}
          onChange={(e) => {
            const v = e.target.value;
            setMdp((m) => ({ ...m, current: v }));
          }}
        />
      </label>
      <label className="setField">
        <span className="setLabel">Nouveau mot de passe</span>
        <input
          type="password"
          value={mdp.next}
          onChange={(e) => {
            const v = e.target.value;
            setMdp((m) => ({ ...m, next: v }));
          }}
        />
      </label>
      <label className="setField">
        <span className="setLabel">Confirmer</span>
        <input
          type="password"
          value={mdp.confirm}
          onChange={(e) => {
            const v = e.target.value;
            setMdp((m) => ({ ...m, confirm: v }));
          }}
        />
      </label>
    </div>
    <div
      className="setPrimary handcr"
      data-off={busy || !mdp.current || mdp.next.length < 8}
      onClick={changerMotDePasse}
    >
      Modifier le mot de passe
    </div>
  </section>
);
