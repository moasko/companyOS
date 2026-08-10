import React, { useEffect, useState } from "react";
import { Icon } from "../utils/general";
import { api } from "../api/client";
import { subscribeSavePicker, closeSavePicker } from "./saveRequest";
import { modal } from "./modalRequest";
import { iconeDeFichier } from "./iconesFichiers";
import "./savepicker.scss";

/// Boîte « Enregistrer sous » : montre le cloud de l'espace de travail
/// pour que l'utilisateur choisisse le dossier de destination, comme il
/// le ferait dans l'Explorateur. Rendue une seule fois, au niveau de App.
export const SavePicker = () => {
  const [request, setRequest] = useState(null);
  const [path, setPath] = useState([{ id: null, name: "Cloud" }]);
  const [nodes, setNodes] = useState([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeSavePicker(setRequest), []);

  const current = path[path.length - 1];

  // À l'ouverture : nom par défaut, et positionnement sur le dossier
  // suggéré par le module s'il existe déjà.
  useEffect(() => {
    if (!request) return;
    setName(request.defaultName || "");
    setError("");

    (async () => {
      try {
        const root = await api.listFiles(null);
        const target =
          request.suggestedFolder &&
          root.find(
            (n) => n.type === "FOLDER" && n.name === request.suggestedFolder,
          );
        if (target) {
          setPath([{ id: null, name: "Cloud" }, { id: target.id, name: target.name }]);
        } else {
          setPath([{ id: null, name: "Cloud" }]);
          setNodes(root);
        }
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [request]);

  useEffect(() => {
    if (!request) return;
    (async () => {
      try {
        setNodes(await api.listFiles(current.id));
        setError("");
      } catch (err) {
        setError(err.message);
      }
    })();
  }, [request, current.id]);

  if (!request) return null;

  const folders = nodes.filter((n) => n.type === "FOLDER");
  const files = nodes.filter((n) => n.type === "FILE");
  const clash = files.some((f) => f.name === name.trim());

  const createFolder = async () => {
    const folderName = await modal.prompt({
      title: "Nouveau dossier",
      label: "Nom du dossier",
      placeholder: "Sans titre",
      confirmLabel: "Créer",
    });
    if (!folderName) return;
    try {
      const created = await api.createFolder(folderName.trim(), current.id);
      setPath([...path, { id: created.id, name: created.name }]);
    } catch (err) {
      setError(err.message);
    }
  };

  const confirm = () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    closeSavePicker({ parentId: current.id, name: name.trim() });
    setBusy(false);
  };

  return (
    <div className="savePickerBack" onClick={() => closeSavePicker(null)}>
      <div className="savePicker" onClick={(e) => e.stopPropagation()}>
        <div className="spHead">
          <Icon fafa="faFloppyDisk" width={13} />
          <span>Enregistrer dans le cloud</span>
        </div>

        <div className="spCrumbs">
          {path.map((step, i) => (
            <React.Fragment key={step.id || "root"}>
              {i > 0 ? <span className="spSep">›</span> : null}
              <span
                className="spCrumb handcr"
                data-last={i === path.length - 1}
                onClick={() => setPath(path.slice(0, i + 1))}
              >
                {step.name}
              </span>
            </React.Fragment>
          ))}
        </div>

        <div className="spList cosScroll">
          {folders.length === 0 && files.length === 0 ? (
            <div className="spEmpty">Ce dossier est vide.</div>
          ) : (
            <>
              {folders.map((f) => (
                <div
                  key={f.id}
                  className="spRow handcr"
                  onDoubleClick={() => setPath([...path, { id: f.id, name: f.name }])}
                  onClick={() => setPath([...path, { id: f.id, name: f.name }])}
                >
                  <Icon src="win/folder" width={18} />
                  <span className="spName">{f.name}</span>
                  <Icon fafa="faChevronRight" width={8} />
                </div>
              ))}
              {files.map((f) => (
                <div
                  key={f.id}
                  className="spRow spFile handcr"
                  onClick={() => setName(f.name)}
                >
                  <Icon src={iconeDeFichier(f)} width={18} />
                  <span className="spName">{f.name}</span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="spNameRow">
          <span className="spLabel">Nom du fichier</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirm()}
            autoFocus
          />
        </div>

        {clash ? (
          <div className="spWarn">
            Un fichier porte déjà ce nom ici — il sera enregistré sous « {name} (2) ».
          </div>
        ) : null}
        {error ? <div className="spWarn spError">{error}</div> : null}

        <div className="spActions">
          <div className="spGhost handcr" onClick={createFolder}>
            Nouveau dossier
          </div>
          <div className="spSpacer" />
          <div className="spGhost handcr" onClick={() => closeSavePicker(null)}>
            Annuler
          </div>
          <div
            className="spPrimary handcr"
            data-off={!name.trim() || busy}
            onClick={confirm}
          >
            Enregistrer
          </div>
        </div>
      </div>
    </div>
  );
};
