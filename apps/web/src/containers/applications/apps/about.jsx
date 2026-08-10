import React from "react";
import { useSelector, useDispatch } from "react-redux";

export const AboutWin = () => {
  const { abOpen } = useSelector((state) => state.desktop);
  const dispatch = useDispatch();

  const action = () => {
    dispatch({ type: "DESKABOUT", payload: false });
  };

  return abOpen ? (
    <div className="aboutApp floatTab dpShad">
      <div className="content p-6">
        <div className="text-xl font-semibold">À propos de CompanyOS</div>
        <p>
          CompanyOS est un système d'exploitation web : un bureau unique qui
          réunit toutes les applications de gestion de l'entreprise et les fait
          communiquer entre elles.
        </p>
        <p>Version 0.1.0</p>
      </div>
      <div className="okbtn px-6 py-4">
        <div data-allow={true} onClick={action}>
          Fermer
        </div>
      </div>
    </div>
  ) : null;
};
