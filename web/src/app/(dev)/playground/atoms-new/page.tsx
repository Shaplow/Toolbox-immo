"use client";

/**
 * Phase 3 — Atomes nouveaux Liquid Glass.
 *
 * Vitrine pour valider visuellement les nouveaux composants au fil des
 * lots. Lot 1 : overlays (Modal, Drawer, Sheet) + hook useDialogStack.
 */

import { useState } from "react";
import { Settings, AlertCircle, Sparkles, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Switch } from "@/components/ui/Switch";
import { Modal } from "@/components/ui/Modal";
import { Drawer } from "@/components/ui/Drawer";
import { Sheet } from "@/components/ui/Sheet";

// ─── Helpers ────────────────────────────────────────────────────────────────

function Section({ id, title, eyebrow, children }: { id: string; title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-4 scroll-mt-20">
      <header className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">{eyebrow}</p>
        <h2 className="text-xl font-semibold tracking-tight text-gray-950">{title}</h2>
      </header>
      <div className="surface-glass-soft rounded-xl p-6">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-6 py-3 border-b border-white/30 last:border-b-0">
      <span className="w-32 shrink-0 text-[10px] uppercase tracking-widest font-medium text-gray-500 pt-2">{label}</span>
      <div className="flex-1 flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AtomsNewPage() {
  // Modal demos
  const [modalSm, setModalSm] = useState(false);
  const [modalMd, setModalMd] = useState(false);
  const [modalLg, setModalLg] = useState(false);
  const [modalXl, setModalXl] = useState(false);
  const [modalSolid, setModalSolid] = useState(false);
  const [modalStack1, setModalStack1] = useState(false);
  const [modalStack2, setModalStack2] = useState(false);

  // Drawer demos
  const [drawerRight, setDrawerRight] = useState(false);
  const [drawerLeft, setDrawerLeft] = useState(false);
  const [drawerBottom, setDrawerBottom] = useState(false);
  const [drawerLg, setDrawerLg] = useState(false);
  const [drawerSolid, setDrawerSolid] = useState(false);

  // Sheet demos
  const [sheetAuto, setSheetAuto] = useState(false);
  const [sheetHalf, setSheetHalf] = useState(false);
  const [sheetFull, setSheetFull] = useState(false);

  // Form state (pour démos contenu)
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [notifications, setNotifications] = useState(true);

  return (
    <div className="space-y-14">
      <header className="space-y-3">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-gray-500">
          Phase 3 · Atomes nouveaux
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-950">
          Modal · Drawer · Sheet
        </h1>
        <p className="text-sm text-gray-600 max-w-2xl leading-relaxed">
          Lot 1 — overlays Liquid Glass partageant le hook <code className="text-[12px] font-mono text-gray-700 bg-white/60 px-1 rounded">useDialogStack</code> :
          empilement z-index automatique, ESC ne ferme que le dialogue au sommet, scroll lock du body.
          Tous variants <code className="text-[12px] font-mono text-gray-700 bg-white/60 px-1 rounded">default</code> (glass) ou <code className="text-[12px] font-mono text-gray-700 bg-white/60 px-1 rounded">solid</code>.
        </p>
      </header>

      {/* ━━━ MODAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="modal" eyebrow="Overlays · P0" title="Modal">
        <Row label="Sizes">
          <Button variant="secondary" size="sm" onClick={() => setModalSm(true)}>Open sm</Button>
          <Button variant="secondary" size="sm" onClick={() => setModalMd(true)}>Open md</Button>
          <Button variant="secondary" size="sm" onClick={() => setModalLg(true)}>Open lg</Button>
          <Button variant="secondary" size="sm" onClick={() => setModalXl(true)}>Open xl</Button>
        </Row>
        <Row label="Variant solid">
          <Button variant="secondary" size="sm" onClick={() => setModalSolid(true)}>Open solid white</Button>
          <span className="text-[12px] text-gray-500">Au lieu du glass strong default</span>
        </Row>
        <Row label="Empilage">
          <Button variant="secondary" size="sm" onClick={() => setModalStack1(true)}>Stack 2 modals</Button>
          <span className="text-[12px] text-gray-500">Ouvre la 1, puis depuis la 1 ouvre la 2 → vérifie z-index + ESC top-only</span>
        </Row>

        {/* ── Instances ────────────────────────────── */}

        <Modal open={modalSm} onClose={() => setModalSm(false)} size="sm">
          <Modal.Header onClose={() => setModalSm(false)}>Petit modal</Modal.Header>
          <Modal.Body>
            <p className="text-[13px] text-gray-700 leading-relaxed">
              Modal compact (max-w-sm). Idéal pour confirmations simples ou actions rapides.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" size="sm" onClick={() => setModalSm(false)}>Annuler</Button>
            <Button size="sm" onClick={() => setModalSm(false)}>OK</Button>
          </Modal.Footer>
        </Modal>

        <Modal open={modalMd} onClose={() => setModalMd(false)} size="md">
          <Modal.Header onClose={() => setModalMd(false)}>Édition rapide</Modal.Header>
          <Modal.Body>
            <div className="space-y-3">
              <Input value={name} onChange={setName} placeholder="Nom" />
              <Textarea value={desc} onChange={setDesc} placeholder="Description…" rows={4} />
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" size="sm" onClick={() => setModalMd(false)}>Annuler</Button>
            <Button size="sm" onClick={() => setModalMd(false)}>Enregistrer</Button>
          </Modal.Footer>
        </Modal>

        <Modal open={modalLg} onClose={() => setModalLg(false)} size="lg">
          <Modal.Header onClose={() => setModalLg(false)}>Aperçu détaillé</Modal.Header>
          <Modal.Body>
            <div className="space-y-3 text-[13px] text-gray-700 leading-relaxed">
              <p>
                Modal large (max-w-2xl). Idéal pour formulaires longs, aperçus
                de contenu (image + métadonnées), tableaux compacts.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Input value={name} onChange={setName} placeholder="Champ A" />
                <Input value={name} onChange={setName} placeholder="Champ B" />
              </div>
              <Textarea value={desc} onChange={setDesc} placeholder="Notes…" rows={3} />
              <div className="flex items-center gap-2">
                <Badge variant="sage" dot>Statut OK</Badge>
                <Badge variant="info" dot>3 modifications</Badge>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" size="sm" onClick={() => setModalLg(false)}>Annuler</Button>
            <Button size="sm" onClick={() => setModalLg(false)}>Confirmer</Button>
          </Modal.Footer>
        </Modal>

        <Modal open={modalXl} onClose={() => setModalXl(false)} size="xl">
          <Modal.Header onClose={() => setModalXl(false)}>Très grand modal</Modal.Header>
          <Modal.Body>
            <p className="text-[13px] text-gray-700">Idéal pour table dense ou builder léger.</p>
          </Modal.Body>
        </Modal>

        <Modal open={modalSolid} onClose={() => setModalSolid(false)} size="md" variant="solid">
          <Modal.Header onClose={() => setModalSolid(false)}>Variant solid</Modal.Header>
          <Modal.Body>
            <p className="text-[13px] text-gray-700 leading-relaxed">
              Background white solide + shadow-modal classique. Utile quand le
              glass crée un contraste insuffisant avec un fond particulier.
            </p>
          </Modal.Body>
        </Modal>

        <Modal open={modalStack1} onClose={() => setModalStack1(false)} size="md">
          <Modal.Header onClose={() => setModalStack1(false)}>Modal niveau 1</Modal.Header>
          <Modal.Body>
            <p className="text-[13px] text-gray-700 mb-3">Ouvre le 2e modal pour tester l'empilement.</p>
            <Button size="sm" onClick={() => setModalStack2(true)} icon={Plus}>Ouvrir modal niveau 2</Button>
          </Modal.Body>
        </Modal>

        <Modal open={modalStack2} onClose={() => setModalStack2(false)} size="sm">
          <Modal.Header onClose={() => setModalStack2(false)}>Modal niveau 2 (top)</Modal.Header>
          <Modal.Body>
            <p className="text-[13px] text-gray-700">
              Je suis au-dessus du modal 1. ESC ne ferme QUE moi. Click backdrop pareil.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button size="sm" onClick={() => setModalStack2(false)}>Fermer</Button>
          </Modal.Footer>
        </Modal>
      </Section>

      {/* ━━━ DRAWER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="drawer" eyebrow="Overlays · P0" title="Drawer">
        <Row label="Sides">
          <Button variant="secondary" size="sm" onClick={() => setDrawerRight(true)}>Right (default)</Button>
          <Button variant="secondary" size="sm" onClick={() => setDrawerLeft(true)}>Left</Button>
          <Button variant="secondary" size="sm" onClick={() => setDrawerBottom(true)}>Bottom</Button>
        </Row>
        <Row label="Size lg">
          <Button variant="secondary" size="sm" onClick={() => setDrawerLg(true)}>Right · 640px</Button>
        </Row>
        <Row label="Variant solid">
          <Button variant="secondary" size="sm" onClick={() => setDrawerSolid(true)}>Open solid white</Button>
        </Row>

        <Drawer open={drawerRight} onClose={() => setDrawerRight(false)} side="right" size="md">
          <Drawer.Header onClose={() => setDrawerRight(false)}>Édition du slot</Drawer.Header>
          <Drawer.Body>
            <div className="space-y-4">
              <Input value={name} onChange={setName} placeholder="Titre" />
              <Textarea value={desc} onChange={setDesc} placeholder="Description du slot…" rows={4} />
              <Switch checked={notifications} onChange={setNotifications} label="Notifier le client" description="Email envoyé à la publication" />
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-500">Tags</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="peach" dot>Brief</Badge>
                  <Badge variant="sage" dot>Validé</Badge>
                  <Badge variant="sky" dot>Programmé</Badge>
                </div>
              </div>
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <Button variant="secondary" size="sm" onClick={() => setDrawerRight(false)}>Annuler</Button>
            <Button size="sm" onClick={() => setDrawerRight(false)}>Enregistrer</Button>
          </Drawer.Footer>
        </Drawer>

        <Drawer open={drawerLeft} onClose={() => setDrawerLeft(false)} side="left" size="md">
          <Drawer.Header onClose={() => setDrawerLeft(false)}>Navigation</Drawer.Header>
          <Drawer.Body>
            <nav className="space-y-1">
              {["Tableau de bord", "Calendrier", "Publications", "Comptes IG", "Médias", "Paramètres"].map((label) => (
                <button key={label} className="w-full flex items-center justify-between px-3 py-2 rounded-md text-[13px] text-gray-700 hover:bg-white/60 hover:text-gray-950 transition-colors">
                  <span>{label}</span>
                  <ChevronRight size={14} className="text-gray-400" />
                </button>
              ))}
            </nav>
          </Drawer.Body>
        </Drawer>

        <Drawer open={drawerBottom} onClose={() => setDrawerBottom(false)} side="bottom" size="md">
          <Drawer.Header onClose={() => setDrawerBottom(false)}>Drawer bottom</Drawer.Header>
          <Drawer.Body>
            <p className="text-[13px] text-gray-700">Drawer ancré bottom — 50vh par défaut (size md).</p>
          </Drawer.Body>
        </Drawer>

        <Drawer open={drawerLg} onClose={() => setDrawerLg(false)} side="right" size="lg">
          <Drawer.Header onClose={() => setDrawerLg(false)}>Drawer large</Drawer.Header>
          <Drawer.Body>
            <p className="text-[13px] text-gray-700">size lg = 640px width. Pour formulaires plus généreux.</p>
          </Drawer.Body>
        </Drawer>

        <Drawer open={drawerSolid} onClose={() => setDrawerSolid(false)} side="right" size="md" variant="solid">
          <Drawer.Header onClose={() => setDrawerSolid(false)}>Drawer solid</Drawer.Header>
          <Drawer.Body>
            <p className="text-[13px] text-gray-700">Background white solide.</p>
          </Drawer.Body>
        </Drawer>
      </Section>

      {/* ━━━ SHEET ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="sheet" eyebrow="Overlays · P0" title="Sheet">
        <Row label="Variants">
          <Button variant="secondary" size="sm" onClick={() => setSheetAuto(true)}>Open auto-height</Button>
          <Button variant="secondary" size="sm" onClick={() => setSheetHalf(true)}>Open 50vh</Button>
          <Button variant="secondary" size="sm" onClick={() => setSheetFull(true)}>Open fullHeight</Button>
        </Row>
        <p className="text-[12px] text-gray-500 mt-3 leading-relaxed">
          Bottom-anchored mobile. Handle macOS/iOS visible en haut. Idéal pour
          feuilles d'actions, sélecteurs, revue compacte.
        </p>

        <Sheet open={sheetAuto} onClose={() => setSheetAuto(false)} variant="auto">
          <Sheet.Header onClose={() => setSheetAuto(false)}>Actions disponibles</Sheet.Header>
          <Sheet.Body>
            <ul className="divide-y divide-white/30">
              {[
                { icon: Sparkles, label: "Marquer comme favori" },
                { icon: Settings, label: "Modifier les paramètres" },
                { icon: AlertCircle, label: "Signaler un problème" },
              ].map((item) => {
                const I = item.icon;
                return (
                  <li key={item.label}>
                    <button className="w-full flex items-center gap-3 px-2 py-3 text-[13px] text-gray-800 hover:text-gray-950">
                      <I size={16} />
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Sheet.Body>
        </Sheet>

        <Sheet open={sheetHalf} onClose={() => setSheetHalf(false)} variant="halfHeight">
          <Sheet.Header onClose={() => setSheetHalf(false)}>Sheet 50 vh</Sheet.Header>
          <Sheet.Body>
            <p className="text-[13px] text-gray-700">Hauteur fixée à la moitié du viewport.</p>
          </Sheet.Body>
        </Sheet>

        <Sheet open={sheetFull} onClose={() => setSheetFull(false)} variant="fullHeight">
          <Sheet.Header onClose={() => setSheetFull(false)}>Sheet plein écran</Sheet.Header>
          <Sheet.Body>
            <p className="text-[13px] text-gray-700">100vh — utile en mobile pour transitions natives.</p>
          </Sheet.Body>
        </Sheet>
      </Section>

      {/* Note pied de page */}
      <div className="surface-glass-soft rounded-xl p-5 mt-12">
        <p className="text-[11px] uppercase tracking-widest font-medium text-gray-500 mb-2">
          Lots restants Phase 3
        </p>
        <p className="text-[13px] text-gray-700 leading-relaxed">
          Lot 2 (P0) → Avatar, Alert, Progress · Lot 3 (P1) → Combobox, Chip,
          Breadcrumb, Stepper, CommandPalette · Lot 4 (P2) → Table, Pagination,
          DatePicker, TimePicker, NumberStepper.
        </p>
      </div>
    </div>
  );
}
