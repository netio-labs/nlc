"use client";

import { createContext, useContext } from "react";

export const TopoModeContext = createContext<{ readonly: boolean }>({ readonly: false });

export function useTopoMode() {
  return useContext(TopoModeContext);
}
