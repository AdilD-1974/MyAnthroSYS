import React, { createContext, useContext } from "react";

export const ManagerReadOnlyContext = createContext<boolean>(false);

export const useManagerReadOnly = () => useContext(ManagerReadOnlyContext);

export const ReadOnlyWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = sessionStorage.getItem("access_token");
  let isReadOnly = false;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      isReadOnly = payload?.role === "manager";
    } catch { isReadOnly = false; }
  }
  return (
    <ManagerReadOnlyContext.Provider value={isReadOnly}>
      {children}
    </ManagerReadOnlyContext.Provider>
  );
};