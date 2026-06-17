"use client";

/**
 * Phase 3 — Atomes nouveaux Liquid Glass.
 *
 * Vitrine pour valider visuellement les nouveaux composants au fil des
 * lots. Lot 1 : overlays (Modal, Drawer, Sheet) + hook useDialogStack.
 */

import { useEffect, useState } from "react";
import { Settings, AlertCircle, Sparkles, ChevronRight, Plus, ExternalLink, Home, Folder, FileText, Calendar, User, Search as SearchIcon, Settings2, Bookmark, Edit3, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Switch } from "@/components/ui/Switch";
import { Modal } from "@/components/ui/Modal";
import { Drawer } from "@/components/ui/Drawer";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar, AvatarGroup } from "@/components/ui/Avatar";
import { Alert } from "@/components/ui/Alert";
import { Progress } from "@/components/ui/Progress";
import { Chip } from "@/components/ui/Chip";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Stepper } from "@/components/ui/Stepper";
import { Combobox } from "@/components/ui/Combobox";
import { CommandPalette, type CommandAction } from "@/components/ui/CommandPalette";
import { Table, type TableColumn } from "@/components/ui/Table";
import { Pagination } from "@/components/ui/Pagination";
import { DatePicker } from "@/components/ui/DatePicker";
import { TimePicker } from "@/components/ui/TimePicker";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { toast } from "@/components/ui/Toast";

// ─── Helpers ────────────────────────────────────────────────────────────────

function Section({ id, title, eyebrow, children }: { id: string; title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-4 scroll-mt-20">
      <header className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-muted-foreground">{eyebrow}</p>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      </header>
      <div className="surface-glass-soft rounded-xl p-6">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-6 py-3 border-b border-white/30 last:border-b-0">
      <span className="w-32 shrink-0 text-[10px] uppercase tracking-widest font-medium text-muted-foreground pt-2">{label}</span>
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
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-muted-foreground">
          Phase 3 · Atomes nouveaux
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Modal · Drawer · Sheet
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
          Lot 1 — overlays Liquid Glass partageant le hook <code className="text-[12px] font-mono text-foreground bg-white/60 px-1 rounded">useDialogStack</code> :
          empilement z-index automatique, ESC ne ferme que le dialogue au sommet, scroll lock du body.
          Tous variants <code className="text-[12px] font-mono text-foreground bg-white/60 px-1 rounded">default</code> (glass) ou <code className="text-[12px] font-mono text-foreground bg-white/60 px-1 rounded">solid</code>.
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
          <span className="text-[12px] text-muted-foreground">Au lieu du glass strong default</span>
        </Row>
        <Row label="Empilage">
          <Button variant="secondary" size="sm" onClick={() => setModalStack1(true)}>Stack 2 modals</Button>
          <span className="text-[12px] text-muted-foreground">Ouvre la 1, puis depuis la 1 ouvre la 2 → vérifie z-index + ESC top-only</span>
        </Row>

        {/* ── Instances ────────────────────────────── */}

        <Modal open={modalSm} onClose={() => setModalSm(false)} size="sm">
          <Modal.Header onClose={() => setModalSm(false)}>Petit modal</Modal.Header>
          <Modal.Body>
            <p className="text-[13px] text-foreground leading-relaxed">
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
            <div className="space-y-3 text-[13px] text-foreground leading-relaxed">
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
            <p className="text-[13px] text-foreground">Idéal pour table dense ou builder léger.</p>
          </Modal.Body>
        </Modal>

        <Modal open={modalSolid} onClose={() => setModalSolid(false)} size="md" variant="solid">
          <Modal.Header onClose={() => setModalSolid(false)}>Variant solid</Modal.Header>
          <Modal.Body>
            <p className="text-[13px] text-foreground leading-relaxed">
              Background white solide + shadow-modal classique. Utile quand le
              glass crée un contraste insuffisant avec un fond particulier.
            </p>
          </Modal.Body>
        </Modal>

        <Modal open={modalStack1} onClose={() => setModalStack1(false)} size="md">
          <Modal.Header onClose={() => setModalStack1(false)}>Modal niveau 1</Modal.Header>
          <Modal.Body>
            <p className="text-[13px] text-foreground mb-3">Ouvre le 2e modal pour tester l'empilement.</p>
            <Button size="sm" onClick={() => setModalStack2(true)} icon={Plus}>Ouvrir modal niveau 2</Button>
          </Modal.Body>
        </Modal>

        <Modal open={modalStack2} onClose={() => setModalStack2(false)} size="sm">
          <Modal.Header onClose={() => setModalStack2(false)}>Modal niveau 2 (top)</Modal.Header>
          <Modal.Body>
            <p className="text-[13px] text-foreground">
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
                <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Tags</p>
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
                <button key={label} className="w-full flex items-center justify-between px-3 py-2 rounded-md text-[13px] text-foreground hover:bg-white/60 hover:text-foreground transition-colors">
                  <span>{label}</span>
                  <ChevronRight size={14} className="text-muted-foreground" />
                </button>
              ))}
            </nav>
          </Drawer.Body>
        </Drawer>

        <Drawer open={drawerBottom} onClose={() => setDrawerBottom(false)} side="bottom" size="md">
          <Drawer.Header onClose={() => setDrawerBottom(false)}>Drawer bottom</Drawer.Header>
          <Drawer.Body>
            <p className="text-[13px] text-foreground">Drawer ancré bottom — 50vh par défaut (size md).</p>
          </Drawer.Body>
        </Drawer>

        <Drawer open={drawerLg} onClose={() => setDrawerLg(false)} side="right" size="lg">
          <Drawer.Header onClose={() => setDrawerLg(false)}>Drawer large</Drawer.Header>
          <Drawer.Body>
            <p className="text-[13px] text-foreground">size lg = 640px width. Pour formulaires plus généreux.</p>
          </Drawer.Body>
        </Drawer>

        <Drawer open={drawerSolid} onClose={() => setDrawerSolid(false)} side="right" size="md" variant="solid">
          <Drawer.Header onClose={() => setDrawerSolid(false)}>Drawer solid</Drawer.Header>
          <Drawer.Body>
            <p className="text-[13px] text-foreground">Background white solide.</p>
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
        <p className="text-[12px] text-muted-foreground mt-3 leading-relaxed">
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
                    <button className="w-full flex items-center gap-3 px-2 py-3 text-[13px] text-gray-800 hover:text-foreground">
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
            <p className="text-[13px] text-foreground">Hauteur fixée à la moitié du viewport.</p>
          </Sheet.Body>
        </Sheet>

        <Sheet open={sheetFull} onClose={() => setSheetFull(false)} variant="fullHeight">
          <Sheet.Header onClose={() => setSheetFull(false)}>Sheet plein écran</Sheet.Header>
          <Sheet.Body>
            <p className="text-[13px] text-foreground">100vh — utile en mobile pour transitions natives.</p>
          </Sheet.Body>
        </Sheet>
      </Section>

      {/* ━━━ AVATAR ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="avatar" eyebrow="Visual · P0" title="Avatar">
        <Row label="Sizes (initials)">
          <Avatar name="Mathis Barbet" size="xs" />
          <Avatar name="Mathis Barbet" size="sm" />
          <Avatar name="Mathis Barbet" size="md" />
          <Avatar name="Mathis Barbet" size="lg" />
          <Avatar name="Mathis Barbet" size="xl" />
        </Row>
        <Row label="Fallback icon">
          <Avatar name="Inconnu" fallback="icon" size="sm" />
          <Avatar name="Inconnu" fallback="icon" size="md" />
          <Avatar name="Inconnu" fallback="icon" size="lg" />
        </Row>
        <Row label="Status">
          <Avatar name="Alice Dubois" status="online" />
          <Avatar name="Bob Martin" status="away" />
          <Avatar name="Camille Petit" status="offline" />
          <span className="text-[12px] text-muted-foreground">online · away · offline</span>
        </Row>
        <Row label="Ring (focus)">
          <Avatar name="Mathis Barbet" ring />
          <Avatar name="Sarah Lemoine" ring size="lg" />
          <span className="text-[12px] text-muted-foreground">Halo sky-200 signature</span>
        </Row>
        <Row label="Group">
          <AvatarGroup
            avatars={[
              { id: "1", name: "Alice Dubois" },
              { id: "2", name: "Bob Martin" },
              { id: "3", name: "Camille Petit" },
              { id: "4", name: "Diane Roux" },
              { id: "5", name: "Eric Lambert" },
            ]}
            max={3}
          />
          <span className="text-[12px] text-muted-foreground">Max 3 visibles + compteur</span>
        </Row>
      </Section>

      {/* ━━━ ALERT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="alert" eyebrow="Visual · P0" title="Alert">
        <div className="space-y-3">
          <Alert variant="info" title="Information">
            La fiche publication a été mise à jour il y a 2 minutes par un autre utilisateur.
          </Alert>
          <Alert variant="success" title="Publication validée" onDismiss={() => {}}>
            Le slot @studio-paris a été marqué comme publié. Le client a été notifié par email.
          </Alert>
          <Alert variant="warning" title="Brief client manquant" actions={
            <Button size="sm" variant="secondary" icon={ExternalLink}>Compléter</Button>
          }>
            Le brief n&apos;a pas été complété par le client depuis 3 jours. Un rappel sera envoyé demain à 9 h.
          </Alert>
          <Alert variant="danger" title="Erreur de rendu" onDismiss={() => {}}>
            Le job de rendu a échoué : codec H.265 non supporté par le worker. Réessaie avec H.264.
          </Alert>
          <Alert variant="glass" title="Astuce">
            Tu peux ouvrir n&apos;importe quelle section en cliquant sur son pill. La sticky-header arrive en Phase 6.
          </Alert>
        </div>
        <div className="mt-4 space-y-2">
          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Sans titre, sans dismiss</p>
          <Alert variant="info">
            Synchronisation en cours… Les données seront actualisées dans quelques secondes.
          </Alert>
        </div>
      </Section>

      {/* ━━━ PROGRESS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="progress" eyebrow="Visual · P0" title="Progress">
        <ProgressShowcase />
      </Section>

      {/* ━━━ CHIP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="chip" eyebrow="Inputs avancés · P1" title="Chip">
        <ChipShowcase />
      </Section>

      {/* ━━━ BREADCRUMB ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="breadcrumb" eyebrow="Inputs avancés · P1" title="Breadcrumb">
        <Row label="Simple">
          <Breadcrumb
            items={[
              { href: "/", label: "Toolbox", icon: <Home size={12} /> },
              { href: "/calendar", label: "Calendrier" },
              { label: "Story #18" },
            ]}
          />
        </Row>
        <Row label="Avec icônes">
          <Breadcrumb
            items={[
              { href: "/admin", label: "Admin", icon: <Settings size={12} /> },
              { href: "/admin/clients", label: "Clients", icon: <Folder size={12} /> },
              { href: "/admin/clients/abc", label: "Studio Paris" },
              { label: "Pattern Vidéo Story", icon: <FileText size={12} /> },
            ]}
          />
        </Row>
        <Row label="Tronqué (5+ items)">
          <Breadcrumb
            truncateAfter={3}
            items={[
              { href: "/", label: "Toolbox" },
              { href: "/a", label: "Niveau 1" },
              { href: "/b", label: "Niveau 2" },
              { href: "/c", label: "Niveau 3" },
              { href: "/d", label: "Niveau 4" },
              { label: "Fiche actuelle" },
            ]}
          />
        </Row>
        <Row label="Separator slash">
          <Breadcrumb
            separator={<span className="text-muted-foreground">/</span>}
            items={[
              { href: "/", label: "Toolbox" },
              { href: "/projets", label: "Projets" },
              { label: "Brief client" },
            ]}
          />
        </Row>
      </Section>

      {/* ━━━ STEPPER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="stepper" eyebrow="Inputs avancés · P1" title="Stepper">
        <StepperShowcase />
      </Section>

      {/* ━━━ COMBOBOX ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="combobox" eyebrow="Inputs avancés · P1" title="Combobox">
        <ComboboxShowcase />
      </Section>

      {/* ━━━ COMMAND PALETTE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="command-palette" eyebrow="Inputs avancés · P1" title="CommandPalette">
        <CommandPaletteShowcase />
      </Section>

      {/* ━━━ TABLE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="table" eyebrow="Data + temps · P2" title="Table">
        <TableShowcase />
      </Section>

      {/* ━━━ PAGINATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="pagination" eyebrow="Data + temps · P2" title="Pagination">
        <PaginationShowcase />
      </Section>

      {/* ━━━ DATE PICKER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="date-picker" eyebrow="Data + temps · P2" title="DatePicker">
        <DatePickerShowcase />
      </Section>

      {/* ━━━ TIME PICKER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="time-picker" eyebrow="Data + temps · P2" title="TimePicker">
        <TimePickerShowcase />
      </Section>

      {/* ━━━ NUMBER STEPPER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}

      <Section id="number-stepper" eyebrow="Data + temps · P2" title="NumberStepper">
        <NumberStepperShowcase />
      </Section>

      {/* Note pied de page — Phase 3 complète */}
      <div className="surface-glass rounded-xl p-5 mt-12">
        <p className="text-[10px] uppercase tracking-[0.16em] font-medium text-success-700 mb-2">
          Phase 3 · clôturée
        </p>
        <p className="text-[13px] text-foreground leading-relaxed">
          16 atomes nouveaux livrés en 4 lots. Prochain chantier : Phase 4 — 11 molécules métier
          (VideoPlayer, AssetCard, Section, StatusBadge, OverrideControl, TrimPlayer, AssigneePicker,
          FilterBar, JobQueueItem, EmptyHero, SoftPanel).
        </p>
      </div>
    </div>
  );
}

// ─── Showcase Table ────────────────────────────────────────────────────────

type RowData = {
  id: string;
  account: string;
  date: string;
  status: "Programmé" | "En cours" | "Publié" | "Refusé";
  assignee: string;
};

function TableShowcase() {
  const allRows: RowData[] = [
    { id: "1", account: "@studio-paris",      date: "2026-03-12", status: "Publié",     assignee: "Alice"  },
    { id: "2", account: "@luxe-immo",         date: "2026-03-13", status: "Programmé",  assignee: "Bob"    },
    { id: "3", account: "@appart-lyon",       date: "2026-03-14", status: "En cours",   assignee: "Camille"},
    { id: "4", account: "@marseille-vue",     date: "2026-03-15", status: "Refusé",     assignee: "Diane"  },
    { id: "5", account: "@bordeaux-design",   date: "2026-03-16", status: "Programmé",  assignee: "Eric"   },
  ];

  const [selected, setSelected] = useState<Set<string>>(new Set(["2"]));

  const columns: TableColumn<RowData>[] = [
    { id: "account", label: "Compte IG", sortable: true, width: "30%" },
    { id: "date", label: "Date", sortable: true, width: "20%" },
    {
      id: "status",
      label: "Statut",
      sortable: true,
      width: "20%",
      cell: (row) => {
        const variantMap = {
          "Programmé":  "sky",
          "En cours":   "peach",
          "Publié":     "sage",
          "Refusé":     "rose",
        } as const;
        return <Chip variant={variantMap[row.status]}>{row.status}</Chip>;
      },
    },
    { id: "assignee", label: "Assigné à", sortable: true },
  ];

  return (
    <>
      <Row label="Sortable + selectable">
        <div className="flex-1 max-w-3xl">
          <Table
            columns={columns}
            rows={allRows}
            rowKey={(r) => r.id}
            selectable
            selectedKeys={selected}
            onSelectionChange={setSelected}
            onRowClick={(r) => toast.info(`Clicked ${r.account}`)}
          />
        </div>
      </Row>
      <p className="text-[12px] text-muted-foreground mt-3 leading-relaxed">
        Header glass sticky · sort cycle asc/desc/null · selection multiple
        avec toggle-all · row hover white/50 backdrop-blur · click row →
        toast (mais checkbox stops propagation).
      </p>

      <div className="mt-6 space-y-2">
        <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Empty state</p>
        <Table columns={columns} rows={[]} empty="Aucune publication dans cette période." />
      </div>
    </>
  );
}

// ─── Showcase Pagination ───────────────────────────────────────────────────

function PaginationShowcase() {
  const [page1, setPage1] = useState(1);
  const [page2, setPage2] = useState(7);

  return (
    <>
      <Row label="Default">
        <div className="flex-1 max-w-2xl">
          <Pagination page={page1} total={42} pageSize={10} onPageChange={setPage1} />
        </div>
      </Row>
      <Row label="Avec résumé">
        <div className="flex-1 max-w-2xl">
          <Pagination page={page2} total={148} pageSize={10} onPageChange={setPage2} showRange />
        </div>
      </Row>
      <Row label="Beaucoup de pages">
        <div className="flex-1 max-w-2xl">
          <Pagination page={page2} total={500} pageSize={10} onPageChange={setPage2} showRange siblingCount={1} />
        </div>
      </Row>
      <Row label="Une seule page">
        <div className="flex-1 max-w-2xl">
          <Pagination page={1} total={5} pageSize={10} onPageChange={() => {}} showRange />
        </div>
      </Row>
    </>
  );
}

// ─── Showcase DatePicker / TimePicker ──────────────────────────────────────

function DatePickerShowcase() {
  const [date1, setDate1] = useState("");
  const [date2, setDate2] = useState("2026-06-15");

  return (
    <>
      <Row label="Vide">
        <div className="w-60"><DatePicker value={date1} onChange={setDate1} /></div>
        <span className="text-[12px] text-muted-foreground">Valeur : {date1 || "(vide)"}</span>
      </Row>
      <Row label="Pré-rempli">
        <div className="w-60"><DatePicker value={date2} onChange={setDate2} /></div>
      </Row>
      <Row label="Min / Max (semaine en cours)">
        <div className="w-60">
          <DatePicker
            value={date2}
            onChange={setDate2}
            min="2026-06-15"
            max="2026-06-21"
          />
        </div>
        <span className="text-[12px] text-muted-foreground">Borné 15→21 juin 2026</span>
      </Row>
      <Row label="Error">
        <div className="w-60"><DatePicker value="" onChange={() => {}} error="Date requise" /></div>
      </Row>
      <Row label="Disabled">
        <div className="w-60"><DatePicker value="2026-01-01" onChange={() => {}} disabled /></div>
      </Row>
    </>
  );
}

function TimePickerShowcase() {
  const [time1, setTime1] = useState("");
  const [time2, setTime2] = useState("18:00");

  return (
    <>
      <Row label="Vide">
        <div className="w-44"><TimePicker value={time1} onChange={setTime1} /></div>
        <span className="text-[12px] text-muted-foreground">Valeur : {time1 || "(vide)"}</span>
      </Row>
      <Row label="Pré-rempli (18:00)">
        <div className="w-44"><TimePicker value={time2} onChange={setTime2} /></div>
      </Row>
      <Row label="Step 15 min">
        <div className="w-44"><TimePicker value={time2} onChange={setTime2} minuteStep={15} /></div>
      </Row>
      <Row label="Disabled">
        <div className="w-44"><TimePicker value="09:00" onChange={() => {}} disabled /></div>
      </Row>
    </>
  );
}

// ─── Showcase NumberStepper ────────────────────────────────────────────────

function NumberStepperShowcase() {
  const [px, setPx] = useState(24);
  const [duration, setDuration] = useState(3.5);
  const [percent, setPercent] = useState(50);
  const [count, setCount] = useState(1);

  return (
    <>
      <Row label="Sans unité">
        <NumberStepper value={count} onChange={setCount} min={0} />
        <span className="text-[12px] text-muted-foreground">Valeur : {count}</span>
      </Row>
      <Row label="Unité px (step 4)">
        <NumberStepper value={px} onChange={setPx} step={4} min={0} max={200} unit="px" />
      </Row>
      <Row label="Unité s (step 0.5, décimal)">
        <NumberStepper value={duration} onChange={setDuration} step={0.5} min={0} max={60} unit="s" />
      </Row>
      <Row label="Unité % (clamped 0-100)">
        <NumberStepper value={percent} onChange={setPercent} step={5} min={0} max={100} unit="%" />
      </Row>
      <Row label="Disabled">
        <NumberStepper value={42} onChange={() => {}} disabled unit="px" />
      </Row>
    </>
  );
}

// ─── Showcase Chip ─────────────────────────────────────────────────────────

// ─── Showcase Chip ─────────────────────────────────────────────────────────

function ChipShowcase() {
  const [tags, setTags] = useState(["Brief", "Validé", "Cuisine ouverte"]);
  const [filter, setFilter] = useState<string | null>(null);

  return (
    <>
      <Row label="Variants">
        <Chip>Default</Chip>
        <Chip variant="peach">Peach</Chip>
        <Chip variant="sage">Sage</Chip>
        <Chip variant="sky">Sky</Chip>
        <Chip variant="rose">Rose</Chip>
      </Row>
      <Row label="Sizes">
        <Chip size="sm">Small</Chip>
        <Chip size="md">Medium</Chip>
      </Row>
      <Row label="Avec icône">
        <Chip icon={Bookmark} variant="sky">Favori</Chip>
        <Chip icon={Edit3} variant="peach">Édition</Chip>
        <Chip icon={Trash2} variant="rose">Supprimer</Chip>
      </Row>
      <Row label="Removable">
        {tags.map((tag) => (
          <Chip
            key={tag}
            variant="sage"
            onRemove={() => setTags(tags.filter((t) => t !== tag))}
          >
            {tag}
          </Chip>
        ))}
        {tags.length === 0 && (
          <button
            onClick={() => setTags(["Brief", "Validé", "Cuisine ouverte"])}
            className="text-[12px] text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Réinitialiser
          </button>
        )}
      </Row>
      <Row label="Interactive (filtres)">
        {(["Tous", "Brouillon", "Validé", "Programmé"] as const).map((label) => (
          <Chip
            key={label}
            variant={label === "Validé" ? "sage" : label === "Programmé" ? "sky" : "default"}
            selected={filter === label}
            onClick={() => setFilter(filter === label ? null : label)}
          >
            {label}
          </Chip>
        ))}
        <span className="text-[12px] text-muted-foreground">Filtre actif : {filter ?? "aucun"}</span>
      </Row>
    </>
  );
}

// ─── Showcase Stepper ──────────────────────────────────────────────────────

function StepperShowcase() {
  const productionSteps = [
    { id: "brief", label: "Brief", description: "Recevoir les infos client" },
    { id: "rushes", label: "Rushes", description: "Tournage / réception" },
    { id: "edit", label: "Montage", description: "Validation monteur" },
    { id: "captions", label: "Captions", description: "Sous-titres + cover" },
    { id: "publish", label: "Publish", description: "Post Instagram" },
  ];

  const [active, setActive] = useState<string | number>("edit");

  return (
    <>
      <div className="space-y-3">
        <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Horizontal linear · interactif</p>
        <Stepper
          steps={productionSteps}
          active={active}
          onClickStep={(s) => setActive(s.id)}
        />
        <p className="text-[11px] text-muted-foreground">Click sur un step pour le passer en in_progress · Active : {active}</p>
      </div>

      <div className="space-y-3 mt-6">
        <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Horizontal glass (avec wrapper)</p>
        <Stepper
          variant="glass"
          steps={productionSteps}
          active={2}
        />
      </div>

      <div className="space-y-3 mt-6">
        <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Compact (dots only)</p>
        <Stepper
          variant="compact"
          steps={productionSteps}
          active={3}
        />
      </div>

      <div className="space-y-3 mt-6">
        <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Vertical glass — fiche détaillée</p>
        <Stepper
          orientation="vertical"
          variant="glass"
          steps={[
            { id: "1", label: "Brief reçu", description: "12 mars 2026 · 14h32", status: "done" },
            { id: "2", label: "Rushes uploadés", description: "Studio Paris a déposé 8 clips", status: "done" },
            { id: "3", label: "Montage v2 en revue", description: "Approbation monteur en attente", status: "in_progress" },
            { id: "4", label: "Captions à générer" },
            { id: "5", label: "Validation cliente", description: "Bloqué : client en congés", status: "blocked" },
          ]}
          className="max-w-md"
        />
      </div>
    </>
  );
}

// ─── Showcase Combobox ─────────────────────────────────────────────────────

function ComboboxShowcase() {
  const [value1, setValue1] = useState("");
  const [value2, setValue2] = useState("");
  const [value3, setValue3] = useState("");

  return (
    <>
      <Row label="Default">
        <div className="w-80">
          <Combobox
            value={value1}
            onChange={setValue1}
            placeholder="Sélectionner un compte IG…"
            options={[
              { value: "studio-paris", label: "@studio-paris", keywords: ["paris", "studio"] },
              { value: "luxe-immo", label: "@luxe-immo", keywords: ["luxe", "premium"] },
              { value: "appart-lyon", label: "@appart-lyon", keywords: ["lyon"] },
              { value: "marseille-vue", label: "@marseille-vue", keywords: ["marseille", "sud"] },
              { value: "bordeaux-design", label: "@bordeaux-design", keywords: ["bordeaux", "design"] },
            ]}
          />
        </div>
        <span className="text-[12px] text-muted-foreground">Valeur : {value1 || "aucune"}</span>
      </Row>
      <Row label="Groupé">
        <div className="w-80">
          <Combobox
            value={value2}
            onChange={setValue2}
            placeholder="Choisir un pattern…"
            options={[
              { value: "video-story", label: "Vidéo Story", group: "Auto", icon: FileText },
              { value: "carousel", label: "Carrousel", group: "Auto", icon: FileText },
              { value: "manual-rushes", label: "Montage externe", group: "Manuel", icon: Edit3 },
              { value: "external-upload", label: "Upload direct", group: "Externe", icon: ExternalLink },
            ]}
          />
        </div>
      </Row>
      <Row label="Allow custom">
        <div className="w-80">
          <Combobox
            value={value3}
            onChange={setValue3}
            allowCustom
            placeholder="Ajouter un tag (tape pour créer)…"
            options={[
              { value: "kitchen", label: "Cuisine ouverte" },
              { value: "balcony", label: "Balcon vue mer" },
              { value: "parking", label: "Parking inclus" },
            ]}
          />
        </div>
      </Row>
      <Row label="Loading + disabled">
        <div className="w-60"><Combobox value="" onChange={() => {}} loading options={[]} placeholder="Chargement…" /></div>
        <div className="w-60"><Combobox value="" onChange={() => {}} disabled options={[]} placeholder="Disabled" /></div>
      </Row>
    </>
  );
}

// ─── Showcase CommandPalette ───────────────────────────────────────────────

function CommandPaletteShowcase() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const actions: CommandAction[] = [
    {
      id: "nav-home",
      label: "Aller au tableau de bord",
      description: "Page d'accueil",
      icon: Home,
      group: "Navigation",
      shortcut: ["G", "H"],
      run: () => toast.info("Nav → /home"),
    },
    {
      id: "nav-calendar",
      label: "Ouvrir le calendrier",
      icon: Calendar,
      group: "Navigation",
      shortcut: ["G", "C"],
      run: () => toast.info("Nav → /calendar"),
    },
    {
      id: "nav-clients",
      label: "Voir les clients",
      icon: User,
      group: "Navigation",
      shortcut: ["G", "L"],
      run: () => toast.info("Nav → /admin/clients"),
    },
    {
      id: "create-slot",
      label: "Créer un slot",
      description: "Ajouter une publication au calendrier",
      icon: Plus,
      group: "Actions",
      shortcut: ["⌘", "N"],
      run: () => toast.success("Slot créé."),
    },
    {
      id: "search-anywhere",
      label: "Recherche globale",
      icon: SearchIcon,
      group: "Actions",
      shortcut: ["/"],
      run: () => toast.info("Recherche globale ouverte"),
    },
    {
      id: "preferences",
      label: "Préférences",
      icon: Settings2,
      group: "Compte",
      shortcut: ["⌘", ","],
      run: () => toast.info("Préférences ouvertes"),
    },
  ];

  return (
    <>
      <Row label="Trigger">
        <Button variant="secondary" size="sm" icon={SearchIcon} onClick={() => setOpen(true)}>
          Ouvrir la palette
        </Button>
        <span className="text-[12px] text-muted-foreground">
          Ou tape <kbd className="text-[10px] font-mono">⌘K</kbd> n&apos;importe où dans la page
        </span>
      </Row>
      <p className="text-[12px] text-muted-foreground mt-3 leading-relaxed">
        cmdk gère le matching fuzzy + l&apos;a11y (focus, ARIA, nav clavier). 6 actions
        dans 3 groupes (Navigation / Actions / Compte) avec raccourcis affichés en Kbd.
      </p>
      <CommandPalette open={open} onClose={() => setOpen(false)} actions={actions} />
    </>
  );
}

// ─── Showcase Progress avec animation ──────────────────────────────────────

function ProgressShowcase() {
  const [animated, setAnimated] = useState(20);

  useEffect(() => {
    const t = setInterval(() => {
      setAnimated((v) => (v >= 100 ? 0 : v + 5));
    }, 600);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <Row label="Linear default">
        <div className="w-72"><Progress value={35} showValue /></div>
        <div className="w-72"><Progress value={68} showValue /></div>
      </Row>
      <Row label="Linear accents">
        <div className="w-72"><Progress value={30} accent="peach" showValue /></div>
        <div className="w-72"><Progress value={60} accent="sage" showValue /></div>
        <div className="w-72"><Progress value={85} accent="sky" showValue /></div>
      </Row>
      <Row label="Sizes">
        <div className="w-72"><Progress value={50} size="sm" showValue /></div>
        <div className="w-72"><Progress value={50} size="md" showValue /></div>
        <div className="w-72"><Progress value={50} size="lg" showValue /></div>
      </Row>
      <Row label="Animé">
        <div className="w-72"><Progress value={animated} accent="sky" showValue /></div>
        <span className="text-[12px] text-muted-foreground">Update en boucle 0 → 100</span>
      </Row>
      <Row label="Indeterminate">
        <div className="w-72"><Progress indeterminate /></div>
        <div className="w-72"><Progress indeterminate accent="peach" /></div>
        <span className="text-[12px] text-muted-foreground">Pour jobs sans % connu</span>
      </Row>
      <Row label="Circular">
        <Progress variant="circular" value={25} size="sm" />
        <Progress variant="circular" value={50} size="md" showValue />
        <Progress variant="circular" value={75} size="lg" accent="sage" showValue />
      </Row>
      <Row label="Circular indeterminate">
        <Progress variant="circular" indeterminate size="sm" />
        <Progress variant="circular" indeterminate size="md" accent="peach" />
        <Progress variant="circular" indeterminate size="lg" accent="sky" />
      </Row>
    </>
  );
}
