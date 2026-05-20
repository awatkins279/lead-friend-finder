## Problem

In `ProviderAccountDialog`, every credential field renders as a single-line `<Input type="password">`. The RingCentral **JWT credential** is a 500+ character string, so:

- You can't see what's in it (masked dots).
- The cursor jumps around in a 1-line field with thousands of hidden characters.
- Backspace/Delete feel broken because the field is scrolled far off to one side.
- There's no quick way to wipe it and paste a fresh one.

## Fix (frontend only, `src/components/ProviderAccountDialog.tsx`)

1. **Extend `ProviderField`** with an optional `multiline?: boolean` flag.
2. **Render multiline fields as `<Textarea>`** (already in `src/components/ui/textarea.tsx`) instead of `<Input>`, with:
   - `rows={4}`, `className="font-mono text-xs break-all"` so long tokens wrap and are readable
   - Same value/onChange wiring as the existing Input
3. **Add a "Show / Hide" toggle** for password-type fields (eye icon) so the user can verify what's pasted.
4. **Add a "Clear" button** next to password/multiline fields — one click empties the value so a fresh paste is trivial.
5. **Mark the RingCentral `jwt` field as `multiline: true`** in `PROVIDER_SPECS.ringcentral.fields`, and update the helper text to say "Paste the full JWT — it's usually 500+ characters on one long line."

Also apply `multiline: true` to **Vonage `private_key`** (PEM blocks are multi-line by nature) since the same dialog handles it.

## Result

- JWT field becomes a roomy textarea you can actually see, edit, and clear.
- One-click **Clear** wipes the field if a bad value is stuck in it.
- **Show/Hide** lets you confirm the pasted value without re-pasting.
- No backend or business-logic changes — this is purely the credentials dialog UI.

## Files touched

- `src/components/ProviderAccountDialog.tsx` (only)

## Out of scope (can do as a follow-up)

- Inline "Where do I find this?" helper popovers next to each field.
- Auto-validating the JWT format on save (check it looks like `xxx.yyy.zzz`).
