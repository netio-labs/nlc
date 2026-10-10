import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ANNOTATION_STYLES } from "@/components/topo/annotation-node";
import {
  ANNOTATION_COLORS,
  LABEL_POSITIONS,
  isBoxKind,
  type AnnotationData,
  type AnnotationNode,
} from "@/lib/topo/types";

const FONT_SIZES = [12, 14, 18, 24, 32];
const STROKE_WIDTHS = [1, 2, 3, 4, 6];

interface AnnotationPanelProps {
  annotation: AnnotationNode;
  update: (patch: Partial<AnnotationData>) => void;
  onDelete: () => void;
}

export function AnnotationPanel({ annotation, update, onDelete }: AnnotationPanelProps) {
  const t = useTranslations("editor.annotationPanel");
  const { kind, text, color, fontSize, strokeWidth, rotation, labelPosition } = annotation.data;
  const isBox = isBoxKind(kind);
  const hasText = isBox || kind === "text";
  const fontSizes = FONT_SIZES.includes(fontSize) ? FONT_SIZES : [...FONT_SIZES, fontSize].sort((a, b) => a - b);

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-foreground/80">{t(`kinds.${kind}`)}</p>

      {hasText && (
        <Field label={kind === "text" ? t("text") : t("label")}>
          <textarea
            rows={3}
            value={text}
            placeholder={kind === "text" ? t("text") : t("optional")}
            onChange={(e) => update({ text: e.target.value })}
            className="w-full resize-y border border-input bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </Field>
      )}

      {isBox && (
        <div className="flex gap-4">
          <Field label={t("labelPosition")}>
            <div className="grid w-fit grid-cols-3 gap-1 border border-input p-1">
              {LABEL_POSITIONS.map((pos) => (
                <button
                  key={pos}
                  title={t(`positions.${pos}`)}
                  aria-label={t("labelAt", { position: t(`positions.${pos}`) })}
                  aria-pressed={pos === labelPosition}
                  onClick={() => update({ labelPosition: pos })}
                  className="flex size-5 cursor-pointer items-center justify-center hover:bg-accent aria-pressed:bg-primary"
                >
                  <span className={`size-1.5 rounded-full ${pos === labelPosition ? "bg-primary-foreground" : "bg-muted-foreground/60"}`} />
                </button>
              ))}
            </div>
          </Field>
          <Field label={t("rotation")}>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                aria-label={t("rotation")}
                min={0}
                max={359}
                value={Math.round(rotation)}
                onChange={(e) => update({ rotation: ((Number(e.target.value) % 360) + 360) % 360 })}
                className="w-16"
              />
              <span className="text-xs text-muted-foreground">°</span>
            </div>
          </Field>
        </div>
      )}

      <Field label={t("color")}>
        <div className="flex gap-2">
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c}
              title={t(`colors.${c}`)}
              aria-label={t(`colors.${c}`)}
              onClick={() => update({ color: c })}
              className={`size-6 cursor-pointer rounded-full ${ANNOTATION_STYLES[c].swatch} ${
                c === color ? "ring-2 ring-ring ring-offset-2 ring-offset-card" : ""
              }`}
            />
          ))}
        </div>
      </Field>

      {kind !== "text" && (
        <Field label={t("lineWidth")}>
          <div className="flex gap-1">
            {STROKE_WIDTHS.map((w) => (
              <button
                key={w}
                title={`${w}px`}
                aria-label={t("lineWidthN", { width: w })}
                aria-pressed={w === strokeWidth}
                onClick={() => update({ strokeWidth: w })}
                className="flex h-7 w-9 cursor-pointer items-center justify-center border border-input hover:bg-accent aria-pressed:border-ring aria-pressed:bg-accent"
              >
                <span className="w-5 rounded-full bg-foreground" style={{ height: w }} />
              </button>
            ))}
          </div>
        </Field>
      )}

      {hasText && (
        <Field label={t("fontSize")}>
          <Select value={String(fontSize)} onValueChange={(v) => update({ fontSize: Number(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent position="item-aligned">
              <SelectGroup>
                {fontSizes.map((s) => <SelectItem key={s} value={String(s)}>{s}px</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      )}

      <Button size="sm" variant="outline" className="w-full text-destructive" onClick={onDelete}>
        {t("delete")}
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
