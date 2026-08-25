// Menu contextuel du canvas : la liste d'actions est construite par le
// composant parent, ce panneau ne gère que l'affichage et la fermeture.

export default function MenuContextuel({ menu, fermer }) {
  if (!menu) return null;
  return (
    <div
      className="imgMenuContextuel"
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.items.map((item) => (
        <button key={item.libelle} data-danger={item.danger} disabled={item.disabled} onClick={() => { item.action?.(); fermer(); }}>
          <span>{item.libelle}</span>
          {item.raccourci ? <small>{item.raccourci}</small> : null}
        </button>
      ))}
    </div>
  );
}
