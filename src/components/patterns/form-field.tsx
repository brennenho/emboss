import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
export function FormField({
  id,
  label,
  error,
  help,
  children,
  required = false,
}: {
  id: string;
  label: string;
  error?: string;
  help?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </FieldLabel>
      {children}
      {help && <FieldDescription id={`${id}-help`}>{help}</FieldDescription>}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  );
}
export function fieldProps(id: string, errors?: Record<string, string>) {
  return {
    id,
    "aria-invalid": !!errors?.[id],
    "aria-describedby": errors?.[id] ? `${id}-error` : undefined,
  };
}
