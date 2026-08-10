import React from "react";
import { Icon } from "../../../../utils/general";
import { Avatar } from "../../../../apps/Avatar";
import { PLANS, ROLES, Row, formatBytes } from "./commun";

export const SectionEspace = ({
  section,
  setSection,
  session,
  usage,
  busy,
  peutGerer,
  nomEspace,
  setNomEspace,
  enregistrerEspace,
  membres,
  changerRole,
  retirerMembre,
  invitations,
  mailInvite,
  setMailInvite,
  roleInvite,
  setRoleInvite,
  inviter,
  copierCode,
  annulerInvitation,
}) => (
  <section className="setSection" data-hidden={section !== "espace"}>
    <h2>Espace de travail</h2>
    <p className="setHint">Identité de l'entreprise et abonnement</p>

    <Row title="Identifiant" desc={session.tenant?.slug || "—"} />
    <Row
      title="Formule"
      desc={`${PLANS[session.tenant?.plan] || "—"} · ${
        usage ? formatBytes(usage.quota) : "—"
      } de stockage`}
    >
      <div
        className="setBadge handcr"
        onClick={() => setSection("formule")}
        title="Voir les formules et tarifs"
      >
        {PLANS[session.tenant?.plan] || "—"}
      </div>
    </Row>

    <div className="setSubTitle">Nom de l'entreprise</div>
    {session.user?.role === "OWNER" ? (
      <div className="setInline">
        <input
          type="text"
          value={nomEspace}
          onChange={(e) => setNomEspace(e.target.value)}
        />
        <div
          className="setPrimary handcr"
          data-off={busy || !nomEspace.trim()}
          onClick={enregistrerEspace}
        >
          Renommer
        </div>
      </div>
    ) : (
      <div className="setEmptyBox">
        Seul le propriétaire de l'espace peut le renommer.
      </div>
    )}

    <div className="setSubTitle">
      Membres de l'équipe
      <span className="setCompte">{membres.length}</span>
    </div>

    <div className="setMembres">
      {membres.map((m) => {
        const moi = m.id === session.user?.id;
        return (
          <div className="setMembre" key={m.id}>
            <Avatar user={m} taille={30} />
            <div className="setMembreInfo">
              <div className="setMembreNom">
                {m.name}
                {moi ? <em> — vous</em> : null}
              </div>
              <div className="setMembreMail">{m.email}</div>
            </div>

            {peutGerer && !moi ? (
              <select
                className="setRole"
                value={m.role}
                disabled={busy}
                onChange={(e) => changerRole(m, e.target.value)}
              >
                {/* Désigner un propriétaire, c'est céder les
                    clés : le serveur le réserve au propriétaire
                    en place, l'écran fait de même. */}
                {session.user?.role === "OWNER" ? (
                  <option value="OWNER">{ROLES.OWNER}</option>
                ) : null}
                <option value="ADMIN">{ROLES.ADMIN}</option>
                <option value="MEMBER">{ROLES.MEMBER}</option>
              </select>
            ) : (
              <span className="setBadge">{ROLES[m.role]}</span>
            )}

            {peutGerer && !moi ? (
              <Icon
                className="setRetirer"
                fafa="faUserMinus"
                width={12}
                onClick={() => retirerMembre(m)}
              />
            ) : null}
          </div>
        );
      })}
    </div>

    {peutGerer ? (
      <>
        <div className="setSubTitle">Inviter quelqu'un</div>
        <p className="setHint">
          L'invitation produit un code à transmettre — par message, de
          vive voix, comme vous voulez. CompanyOS n'envoie pas d'e-mail.
        </p>
        <div className="setInline">
          <input
            type="email"
            placeholder="adresse@entreprise.ci"
            value={mailInvite}
            onChange={(e) => setMailInvite(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && inviter()}
          />
          <select
            className="setRole"
            value={roleInvite}
            onChange={(e) => setRoleInvite(e.target.value)}
          >
            <option value="MEMBER">{ROLES.MEMBER}</option>
            <option value="ADMIN">{ROLES.ADMIN}</option>
          </select>
          <div
            className="setPrimary handcr"
            data-off={busy || !mailInvite.trim()}
            onClick={inviter}
          >
            Inviter
          </div>
        </div>

        {invitations.length ? (
          <>
            <div className="setSubTitle">Invitations en attente</div>
            <div className="setMembres">
              {invitations.map((i) => (
                <div className="setMembre" key={i.id}>
                  <span className="setAvatar setAvatarAttente">
                    <Icon fafa="faHourglassHalf" width={11} />
                  </span>
                  <div className="setMembreInfo">
                    <div className="setMembreNom">{i.email}</div>
                    <div className="setMembreMail">
                      {ROLES[i.role]} · expire le{" "}
                      {new Date(i.expiresAt).toLocaleDateString("fr-FR")}
                    </div>
                  </div>
                  <code
                    className="setCode handcr"
                    title="Cliquer pour copier"
                    onClick={() => copierCode(i.code)}
                  >
                    {i.code}
                  </code>
                  <Icon
                    className="setRetirer"
                    fafa="faXmark"
                    width={12}
                    onClick={() => annulerInvitation(i)}
                  />
                </div>
              ))}
            </div>
          </>
        ) : null}
      </>
    ) : (
      <div className="setEmptyBox">
        Seuls les administrateurs de l'espace peuvent inviter ou
        retirer des membres.
      </div>
    )}
  </section>
);
