import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Category picker: choose from the categories already in the catalogue
 * instead of typing. Optional — leaving it untouched saves as "General".
 */
export function CategorySelect({
  id,
  value,
  categories,
  onChange,
  className,
}: {
  id?: string;
  /** "" means no category chosen yet. */
  value: string;
  categories: string[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const options = [...new Set(["General", ...categories].filter(Boolean))];
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder="Choose category (optional)" />
      </SelectTrigger>
      <SelectContent>
        {options.map((c) => (
          <SelectItem key={c} value={c}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
