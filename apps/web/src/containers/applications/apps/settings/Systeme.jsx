import React from "react";
import { Image } from "../../../../utils/general";
import { PLANS, Row, VERSION, formatBytes } from "./commun";

export const SectionSysteme = ({
  section,
  wall,
  session,
  installed,
  usage,
  goToSection,
  deconnecter,
}) => (
  <section className="setSection" data-hidden={section !== "systeme"}>
    <h2>Système</h2>
    <p className="setHint">Version, session et raccourcis</p>

    <div className="setCard setSysCard">
      <Image src={`img/wallpaper/${wall.src}`} w={110} ext />
      <div>
        <div className="setSysName">CompanyOS</div>
        <div className="setSysMeta">
          Version {VERSION} · {session.tenant?.name || "—"}
        </div>
        <div className="setSysMeta">
          Plan {PLANS[session.tenant?.plan] || "—"} ·{" "}
          {installed.length} application
          {installed.length > 1 ? "s" : ""} installée
          {installed.length > 1 ? "s" : ""}
        </div>
      </div>
    </div>

    <Row
      title="Stockage utilisé"
      desc={
        usage
          ? `${formatBytes(usage.usedBytes)} sur ${formatBytes(usage.quota)}`
          : "Chargement…"
      }
    >
      <div
        className="setBtnGhost handcr"
        onClick={() => goToSection("stockage")}
      >
        Détail
      </div>
    </Row>

    <Row title="Mises à jour" desc={`CompanyOS ${VERSION} — à jour`}>
      <div className="setBadge">À jour</div>
    </Row>

    <Row
      title="Session"
      desc={`Connecté en tant que ${session.user?.email || "—"}`}
    >
      <div className="setBtnGhost setDanger handcr" onClick={deconnecter}>
        Se déconnecter
      </div>
    </Row>
  </section>
);
