import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
export function ToggleField({
  id,
  label,
  help,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  help?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-5">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {help && (
          <p className="muted mt-1" id={`${id}-help`}>
            {help}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-describedby={help ? `${id}-help` : undefined}
      />
    </div>
  );
}
