"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { confirmedPhraseSchema, type PersonalPhrase } from "./contracts";
import type { usePersonalLibrary } from "./use-personal-library";

type Props = {
  library: ReturnType<typeof usePersonalLibrary>;
  sourcePhrase: string;
  language: "ja" | "zh";
  workTagIds: string[];
  onWorkTagsChange: (ids: string[]) => void;
  overlays: { phraseId: string; start: number; end: number; surface: string }[];
};

function PhraseDetails({ phrase }: { phrase: PersonalPhrase }) {
  return (
    <div className="flex flex-col gap-1">
      <strong lang={phrase.language}>{phrase.sourcePhrase}</strong>
      {phrase.glosses.map((gloss) => (
        <p key={gloss.language} lang={gloss.language}>
          {gloss.language === "en" ? "English" : "Vietnamese"}: {gloss.text}
        </p>
      ))}
      {phrase.note && <p>{phrase.note}</p>}
      <p className="text-sm text-muted-foreground">
        Your personal phrase ·{" "}
        {phrase.workTags.map((tag) => tag.name).join(", ")}
      </p>
    </div>
  );
}

function PhraseForm({
  library,
  sourcePhrase,
  language,
  workTagIds,
}: Omit<Props, "onWorkTagsChange" | "overlays">) {
  const id = useId();
  const [en, setEn] = useState("");
  const [vi, setVi] = useState("");
  const [note, setNote] = useState("");
  const [invalid, setInvalid] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = confirmedPhraseSchema.safeParse({
      sourcePhrase,
      language,
      note,
      glosses: [
        ...(en.trim() ? [{ language: "en", text: en }] : []),
        ...(vi.trim() ? [{ language: "vi", text: vi }] : []),
      ],
      workTagIds: workTagIds.filter((tagId) =>
        library.tags.some((tag) => tag.id === tagId),
      ),
    });
    setInvalid(!parsed.success);
    if (parsed.success && (await library.savePhrase(parsed.data))) {
      setEn("");
      setVi("");
      setNote("");
    }
  }
  return (
    <form onSubmit={save}>
      <FieldSet disabled={library.busy}>
        <FieldLegend>Save selected phrase</FieldLegend>
        <FieldDescription>
          Only this phrase, your glosses, note and selected work tags are saved
          to your account.
        </FieldDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-source`}>
              Selected phrase · {language === "ja" ? "Japanese" : "Chinese"}
            </FieldLabel>
            <Input
              id={`${id}-source`}
              value={sourcePhrase}
              readOnly
              lang={language}
            />
          </Field>
          <Field data-invalid={invalid && !en.trim() && !vi.trim()}>
            <FieldLabel htmlFor={`${id}-en`}>English gloss</FieldLabel>
            <Input
              id={`${id}-en`}
              value={en}
              onChange={(event) => setEn(event.target.value)}
              maxLength={500}
              aria-invalid={invalid && !en.trim() && !vi.trim()}
            />
          </Field>
          <Field data-invalid={invalid && !en.trim() && !vi.trim()}>
            <FieldLabel htmlFor={`${id}-vi`}>Vietnamese gloss</FieldLabel>
            <Input
              id={`${id}-vi`}
              value={vi}
              onChange={(event) => setVi(event.target.value)}
              maxLength={500}
              aria-invalid={invalid && !en.trim() && !vi.trim()}
            />
            <FieldDescription>
              Supply one or both glosses and select at least one work tag above.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-note`}>
              Personal note (optional)
            </FieldLabel>
            <Input
              id={`${id}-note`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
            />
          </Field>
          {invalid && (
            <FieldError>
              Choose a phrase of at most 300 characters, one or both glosses,
              and 1–20 work tags.
            </FieldError>
          )}
          <Button type="submit" disabled={!sourcePhrase || library.busy}>
            Save personal phrase
          </Button>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}

export function PersonalLibrary({
  library,
  sourcePhrase,
  language,
  workTagIds,
  onWorkTagsChange,
  overlays,
}: Props) {
  const id = useId();
  const [tagName, setTagName] = useState("");
  const preferred = library.phrases.filter(
    (phrase) =>
      overlays.some((overlay) => overlay.phraseId === phrase.id) &&
      phrase.language === language &&
      phrase.workTags.some((tag) => workTagIds.includes(tag.id)),
  );
  return (
    <section aria-label="Personal library" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3>Personal library</h3>
        <p role="status" className="text-sm text-muted-foreground">
          {library.busy ? "Updating personal library…" : library.message}
        </p>
        {library.account && (
          <p className="text-sm">Account: {library.account.displayName}</p>
        )}
        {library.status === "sign-in" && <Link href="/sign-in">Sign in</Link>}
        {library.pendingWarning && (
          <>
            <p role="alert" className="text-sm text-muted-foreground">
              {library.pendingWarning}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={library.busy}
              onClick={() => void library.recheckPending()}
            >
              Recheck saved edits
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={library.busy}
          onClick={() => void library.load()}
        >
          Load personal library
        </Button>
      </div>
      {library.account && (
        <>
          {preferred.length > 0 && (
            <div
              className="flex flex-col gap-3"
              aria-label="Preferred personal matches"
            >
              <h4>Preferred personal matches</h4>
              {preferred.map((phrase) => (
                <PhraseDetails key={phrase.id} phrase={phrase} />
              ))}
            </div>
          )}
          <FieldSet>
            <FieldLegend>Active work tags</FieldLegend>
            <FieldDescription>
              Filter exact personal matches locally. These tags also apply when
              you save a phrase.
            </FieldDescription>
            <FieldGroup>
              {library.tags.map((tag) => (
                <Field key={tag.id} orientation="horizontal">
                  <Checkbox
                    id={`${id}-${tag.id}`}
                    checked={workTagIds.includes(tag.id)}
                    onCheckedChange={(checked) =>
                      onWorkTagsChange(
                        checked
                          ? [...new Set([...workTagIds, tag.id])]
                          : workTagIds.filter((value) => value !== tag.id),
                      )
                    }
                  />
                  <FieldLabel htmlFor={`${id}-${tag.id}`}>
                    {tag.name}
                  </FieldLabel>
                </Field>
              ))}
            </FieldGroup>
          </FieldSet>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (await library.addTag(tagName)) setTagName("");
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${id}-new-tag`}>
                  New personal work tag
                </FieldLabel>
                <Input
                  id={`${id}-new-tag`}
                  value={tagName}
                  onChange={(event) => setTagName(event.target.value)}
                  maxLength={80}
                  required
                  disabled={library.busy}
                />
              </Field>
              <Button
                type="submit"
                variant="outline"
                disabled={library.busy || !tagName.trim()}
              >
                Add personal tag
              </Button>
            </FieldGroup>
          </form>
          <Separator />
          {sourcePhrase ? (
            <PhraseForm
              key={`${library.account.id}:${language}:${sourcePhrase}`}
              library={library}
              sourcePhrase={sourcePhrase}
              language={language}
              workTagIds={workTagIds}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Select adjacent tokens to save a personal phrase.
            </p>
          )}
          {library.pending.length > 0 && (
            <div
              className="flex flex-col gap-3"
              aria-label="Unsynced personal phrases"
            >
              <h4>Unsynced personal phrases</h4>
              {library.pending.map((record) => (
                <div key={record.id} className="flex flex-col gap-2">
                  <p lang={record.input.language}>
                    {record.input.sourcePhrase} · Unsynced
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={library.busy}
                    onClick={() => void library.retryPhrase(record.id)}
                  >
                    Retry personal phrase
                  </Button>
                </div>
              ))}
            </div>
          )}
          <details>
            <summary>All personal phrases ({library.phrases.length})</summary>
            <div className="flex flex-col gap-4">
              {library.phrases.map((phrase) => (
                <PhraseDetails key={phrase.id} phrase={phrase} />
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
