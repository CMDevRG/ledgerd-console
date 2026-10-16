import { Button } from '../../ui/Button';
import { Field, Input } from '../../ui/Field';

interface IdempotencyKeyFieldProps {
  value: string;
  error?: string | undefined;
  onChange: (key: string) => void;
  onNewKey: () => void;
}

/** The key that goes with the request, shown and editable before sending (requirement R7.1). */
export function IdempotencyKeyField({
  value,
  error,
  onChange,
  onNewKey,
}: IdempotencyKeyFieldProps) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Field
        label="Idempotency key"
        hint="Sending the same key and request again gives back the first result instead of doing it twice."
        error={error}
        className="min-w-0 max-w-xl flex-1"
      >
        {(control) => (
          <Input
            {...control}
            data-field="key"
            value={value}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        )}
      </Field>
      <div className="self-end">
        <Button onClick={onNewKey}>New key</Button>
      </div>
    </div>
  );
}
