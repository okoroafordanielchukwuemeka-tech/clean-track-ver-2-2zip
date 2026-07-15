import { DEFAULT_SERVICE_ICONS, resolveServiceImage, getIconByKey } from "@/lib/service-icons";
import { cn } from "@/lib/utils";

/** Renders a service's image: custom photo, explicitly-picked default icon, or a name-matched suggested icon. */
export function ServiceImage({ name, imageUrl, className, iconClassName }: {
  name: string;
  imageUrl?: string | null;
  className?: string;
  iconClassName?: string;
}) {
  const resolved = resolveServiceImage(name, imageUrl);

  if (resolved.kind === "photo") {
    return (
      <img
        src={resolved.url}
        alt={name}
        className={cn("object-cover", className)}
      />
    );
  }

  const Icon = resolved.icon.Icon;
  return (
    <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)} title={resolved.isSuggested ? `Suggested: ${resolved.icon.label}` : resolved.icon.label}>
      <Icon className={cn("h-2/3 w-2/3", iconClassName)} />
    </div>
  );
}

/** Grid picker for the built-in default icon library. */
export function IconPicker({ value, onSelect }: { value?: string | null; onSelect: (key: string) => void }) {
  return (
    <div className="grid grid-cols-6 gap-2 max-h-56 overflow-y-auto p-1">
      {DEFAULT_SERVICE_ICONS.map(({ key, label, Icon }) => (
        <button
          type="button"
          key={key}
          title={label}
          onClick={() => onSelect(key)}
          className={cn(
            "flex flex-col items-center justify-center gap-1 rounded-md border p-2 text-[10px] text-muted-foreground hover:border-primary hover:text-foreground transition-colors",
            value === key && "border-primary bg-primary/10 text-foreground"
          )}
        >
          <Icon className="h-6 w-6" />
          <span className="leading-tight text-center line-clamp-1">{label}</span>
        </button>
      ))}
    </div>
  );
}
