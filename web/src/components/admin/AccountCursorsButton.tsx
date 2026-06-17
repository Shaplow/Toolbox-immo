"use client";

/**
 * AccountCursorsButton — Sprint D.
 *
 * Bouton "Curseurs" sur la fiche compte admin qui ouvre le drawer
 * AllCursorsForAccountDrawer pour gérer en cross-libs.
 */

import { useState } from "react";
import { RotateCw } from "lucide-react";
import { AllCursorsForAccountDrawer } from "./cursors/AllCursorsForAccountDrawer";

interface Props {
  accountId: string;
  accountHandle: string;
}

export function AccountCursorsButton({ accountId, accountHandle }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-card border border-border text-foreground hover:text-foreground text-[11px] font-medium  hover: transition-all"
        title="Voir et ajuster tous les curseurs de rotation de ce compte"
      >
        <RotateCw size={12} />
        Curseurs
      </button>
      {open && (
        <AllCursorsForAccountDrawer
          accountId={accountId}
          accountHandle={accountHandle}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
