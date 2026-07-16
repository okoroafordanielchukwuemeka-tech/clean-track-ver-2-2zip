import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface CommandPaletteContextValue {
  open: boolean;
  query: string;
  openPalette: (initialQuery?: string) => void;
  closePalette: () => void;
  setQuery: (q: string) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const openPalette = useCallback((initialQuery = "") => {
    setQuery(initialQuery);
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open, query, openPalette, closePalette, setQuery }}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used inside CommandPaletteProvider");
  return ctx;
}
