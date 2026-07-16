import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const shortcuts = [
  {
    group: "Navigation",
    items: [
      { keys: ["Ctrl", "K"], mac: ["⌘", "K"], label: "Open command palette" },
      { keys: ["Esc"], mac: ["Esc"], label: "Close dialog or palette" },
    ],
  },
  {
    group: "Quick Actions",
    items: [
      { keys: ["Ctrl", "N"], mac: ["⌘", "N"], label: "Create order" },
      { keys: ["Ctrl", "Shift", "C"], mac: ["⌘", "⇧", "C"], label: "Create customer" },
      { keys: ["/"], mac: ["/"], label: "Focus search (on supported pages)" },
    ],
  },
  {
    group: "Help",
    items: [
      { keys: ["?"], mac: ["?"], label: "Open this keyboard shortcut reference" },
    ],
  },
];

function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded border border-border bg-muted text-muted-foreground text-xs font-mono font-semibold shadow-sm">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsHelp({ open, onOpenChange }: Props) {
  const mac = isMac();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-muted-foreground" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5 pt-2">
          {shortcuts.map((group) => (
            <div key={group.group}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                {group.group}
              </p>
              <div className="space-y-1.5">
                {group.items.map((item) => {
                  const keys = mac ? item.mac : item.keys;
                  return (
                    <div key={item.label} className="flex items-center justify-between gap-4 py-1">
                      <span className="text-sm text-foreground">{item.label}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {keys.map((k, i) => (
                          <span key={i} className="flex items-center gap-1">
                            <Key>{k}</Key>
                            {i < keys.length - 1 && (
                              <span className="text-muted-foreground text-xs">+</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground pt-2 border-t">
          Shortcuts are disabled when typing in a text field.
        </p>
      </DialogContent>
    </Dialog>
  );
}
